/**
 * WorkSpot — Scout Agent
 *
 * Picks the highest-priority city that hasn't been scouted in
 * the last 7 days, asks Google Places for coffee shops / cafes
 * / hotel lobbies in that area, dedupes against existing rows
 * by `google_place_id`, fetches reviews for each new candidate,
 * and inserts them into `spots` as `status='pending'` with
 * notes + vibe_tags populated from review analysis.
 *
 * Scoring is intentionally NOT done here — that's the Curator's
 * job. We leave `workability_score` and the other score columns
 * at their defaults so the Curator's daily pass can pick them up.
 *
 * Cost caps:
 *   - $0.50 per run (hard) — checked before each Places API call.
 *   - $3.00 per rolling 24h (hard) — checked at run start by
 *     summing total_cost_usd from scout_runs.
 *
 * Each invocation writes one row to scout_runs (status starts as
 * 'running', gets finalized to 'success' / 'partial' / 'cap_hit'
 * / 'skipped' / 'error').
 *
 * Usage:
 *   npx tsx scripts/scout.ts            # one run
 *   npx tsx scripts/scout.ts --dry-run  # don't insert / don't bill
 *   npx tsx scripts/scout.ts --city="Austin"  # force a city
 */

import {
  textSearch,
  getPlaceDetails,
  convertHours,
  mapPlaceType,
  noiseLevelFromText,
  seatingComfortFromData,
  vibeTagsFromPlace,
  photoUrlRedirect,
  GPPlace,
} from '../src/lib/google-places'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import * as fs from 'fs'

// ── Config ────────────────────────────────────────────────────

const isDryRun = process.argv.includes('--dry-run')
const cityArg = process.argv.find((a) => a.startsWith('--city='))
const FORCED_CITY = cityArg ? cityArg.split('=')[1] : null

// Google Places (New) SKU-based estimates. These are conservative
// — if Google reprices, bump them up here rather than tightening
// the cap, so we naturally throttle.
const COST = {
  textSearch: 0.032,    // Text Search Basic SKU
  placeDetails: 0.017,  // Place Details (Pro) — fields include reviews
}

const PER_RUN_CAP_USD = 0.50
const DAILY_CAP_USD = 3.00
const COOLDOWN_DAYS = 7
const MAX_CANDIDATES_PER_RUN = 25

const SEARCH_QUERY_TEMPLATES = [
  'coffee shop',
  'cafe',
  'hotel lobby',
]

// ── Env loading (mirrors import-nyc.ts) ──────────────────────

function loadEnv() {
  try {
    const raw = fs.readFileSync('.env.local', 'utf-8')
    for (const line of raw.split('\n')) {
      const [key, ...val] = line.split('=')
      if (key && !key.startsWith('#') && key.trim()) {
        process.env[key.trim()] = val.join('=').trim()
      }
    }
  } catch {
    // .env.local not found — rely on process.env
  }
}

loadEnv()

const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY ?? ''
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

function log(msg: string) {
  process.stdout.write(msg + '\n')
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Types ─────────────────────────────────────────────────────

interface PriorityRow {
  id: string
  city: string
  neighborhood: string | null
  priority_score: number
  last_scouted_at: string | null
  lat: number | null
  lng: number | null
  radius_meters: number | null
}

type RunStatus = 'running' | 'success' | 'partial' | 'skipped' | 'error' | 'cap_hit'

// ── Helpers ───────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

function citySlug(city: string): string {
  if (city === 'New York City') return 'nyc'
  return slugify(city)
}

function buildSearchQuery(template: string, target: PriorityRow): string {
  // Bias the text query toward the right area — even with lat/lng
  // locationBias, Places gives much better results when the city is
  // also in the query string. Neighborhoods are appended when
  // present so a Brooklyn run doesn't grab Manhattan results.
  const parts = [template]
  if (target.neighborhood) parts.push(target.neighborhood)
  parts.push(target.city)
  return parts.join(' ')
}

// ── Place → spot row (Scout's flavor: NO scoring) ────────────

function placeToScoutRow(place: GPPlace, target: PriorityRow) {
  const reviews = place.reviews ?? []
  const allReviewText = reviews.map((r) => r.text?.text ?? '').join(' ')
  const reviewLower = allReviewText.toLowerCase()

  const hours = convertHours(place.regularOpeningHours)
  const type = mapPlaceType(place.types ?? [])
  const name = place.displayName?.text ?? 'Unknown'
  const address = place.formattedAddress ?? ''

  const notes =
    place.editorialSummary?.text ??
    reviews[0]?.text?.text?.slice(0, 280) ??
    ''

  return {
    name,
    slug: `${slugify(name)}-${citySlug(target.city)}-${place.id.slice(-6)}`,
    type,
    address,
    city: target.city,
    neighborhood: target.neighborhood ?? null,
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    google_place_id: place.id,
    photos: (place.photos ?? []).slice(0, 4).map((p, i) => ({
      url: photoUrlRedirect(p.name, 800),
      caption: i === 0 ? 'Main' : `Photo ${i + 1}`,
    })),
    hours,
    // Amenity flags from review text — cheap heuristics that the
    // Curator can override. Scout deliberately stays conservative:
    // we don't want to misrepresent a place as wifi-having just
    // because it's a cafe.
    has_wifi: reviewLower.includes('wifi') || reviewLower.includes('wi-fi') || type === 'coffee_shop' || type === 'hotel_lobby',
    has_outlets: reviewLower.includes('outlet') || reviewLower.includes('charging') || reviewLower.includes('plug'),
    laptop_friendly: reviewLower.includes('laptop') || reviewLower.includes('work'),
    has_bathroom: type !== 'other',
    has_food: type === 'diner' || type === 'bar' || reviewLower.includes('food') || reviewLower.includes('menu'),
    has_drinks: type !== 'library',
    noise_level: noiseLevelFromText(allReviewText),
    seating_comfort: seatingComfortFromData(reviews, place.priceLevel),
    vibe_tags: vibeTagsFromPlace(place, reviews),
    notes,
    // CRITICAL: leave the score columns at their defaults (0).
    // Curator owns workability_score / work_score / etc.
    status: 'pending' as const,
    submitted_by: 'scout-agent',
  }
}

// ── Supabase helpers ──────────────────────────────────────────

async function readDailySpend(db: SupabaseClient): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await db
    .from('scout_runs')
    .select('total_cost_usd')
    .gte('started_at', since)
  if (error) {
    log(`  ⚠ Couldn't read daily spend (${error.message}) — defaulting to $0`)
    return 0
  }
  return (data ?? []).reduce((s, r: { total_cost_usd: number | string }) => s + Number(r.total_cost_usd ?? 0), 0)
}

async function pickNextCity(db: SupabaseClient): Promise<PriorityRow | null> {
  if (FORCED_CITY) {
    const { data, error } = await db
      .from('scout_priority')
      .select('*')
      .eq('city', FORCED_CITY)
      .order('priority_score', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error || !data) return null
    return data as PriorityRow
  }

  const cutoff = new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString()
  // Eligible = never scouted OR last scouted before cutoff.
  // Pick highest priority_score; tiebreak by oldest last_scouted_at
  // (NULLs first) so brand-new metros get on the board.
  const { data, error } = await db
    .from('scout_priority')
    .select('*')
    .or(`last_scouted_at.is.null,last_scouted_at.lt.${cutoff}`)
    .order('priority_score', { ascending: false })
    .order('last_scouted_at', { ascending: true, nullsFirst: true })
    .limit(1)
  if (error) {
    log(`  ⚠ pickNextCity error: ${error.message}`)
    return null
  }
  return (data?.[0] as PriorityRow) ?? null
}

async function findExistingPlaceIds(db: SupabaseClient, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const { data, error } = await db
    .from('spots')
    .select('google_place_id')
    .in('google_place_id', ids)
  if (error) {
    log(`  ⚠ dedup query error: ${error.message}`)
    return new Set()
  }
  return new Set((data ?? []).map((r: { google_place_id: string }) => r.google_place_id))
}

async function startRun(
  db: SupabaseClient,
  target: PriorityRow | null,
): Promise<string | null> {
  if (isDryRun) return null
  const { data, error } = await db
    .from('scout_runs')
    .insert({
      city: target?.city ?? null,
      neighborhood: target?.neighborhood ?? null,
      status: 'running',
    })
    .select('run_id')
    .single()
  if (error) {
    log(`  ⚠ Couldn't open scout_runs row: ${error.message}`)
    return null
  }
  return (data as { run_id: string }).run_id
}

async function finishRun(
  db: SupabaseClient,
  runId: string | null,
  patch: {
    status: RunStatus
    candidates_examined: number
    candidates_inserted: number
    total_cost_usd: number
    error_message?: string | null
    notes?: string | null
  },
) {
  if (isDryRun || !runId) return
  const { error } = await db
    .from('scout_runs')
    .update({
      ...patch,
      total_cost_usd: Number(patch.total_cost_usd.toFixed(4)),
      finished_at: new Date().toISOString(),
    })
    .eq('run_id', runId)
  if (error) log(`  ⚠ Couldn't close scout_runs row: ${error.message}`)
}

async function markScouted(db: SupabaseClient, priorityId: string) {
  if (isDryRun) return
  const { error } = await db
    .from('scout_priority')
    .update({ last_scouted_at: new Date().toISOString() })
    .eq('id', priorityId)
  if (error) log(`  ⚠ Couldn't update last_scouted_at: ${error.message}`)
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  if (!GOOGLE_KEY || GOOGLE_KEY.includes('placeholder')) {
    log('❌ GOOGLE_PLACES_API_KEY is not set in .env.local')
    process.exit(1)
  }
  if (!isDryRun && (!SUPABASE_URL || SUPABASE_URL.includes('placeholder') || !SUPABASE_SERVICE_KEY)) {
    log('❌ Supabase credentials missing. Use --dry-run to test without DB.')
    process.exit(1)
  }

  const db: SupabaseClient = createClient(
    SUPABASE_URL || 'https://placeholder.supabase.co',
    SUPABASE_SERVICE_KEY || 'placeholder',
  )

  log(`\n🔭 WorkSpot — Scout Agent`)
  log(`   Mode: ${isDryRun ? 'DRY RUN (no writes, no billing tracked)' : 'LIVE'}`)
  log(`   Caps: $${PER_RUN_CAP_USD.toFixed(2)}/run, $${DAILY_CAP_USD.toFixed(2)}/24h`)

  // ── Daily cap check ───────────────────────────────────────
  let dailySpend = 0
  if (!isDryRun) {
    dailySpend = await readDailySpend(db)
    log(`   24h spend so far: $${dailySpend.toFixed(4)}`)
    if (dailySpend >= DAILY_CAP_USD) {
      log(`   ⛔ Daily cap reached — recording a skipped run and exiting.`)
      const runId = await startRun(db, null)
      await finishRun(db, runId, {
        status: 'skipped',
        candidates_examined: 0,
        candidates_inserted: 0,
        total_cost_usd: 0,
        notes: `Daily cap hit ($${dailySpend.toFixed(4)} / $${DAILY_CAP_USD.toFixed(2)})`,
      })
      return
    }
  }

  // ── Pick a city ───────────────────────────────────────────
  const target = await pickNextCity(db)
  if (!target) {
    log(`   ⛔ No eligible city found (all scouted within ${COOLDOWN_DAYS}d). Exiting.`)
    const runId = await startRun(db, null)
    await finishRun(db, runId, {
      status: 'skipped',
      candidates_examined: 0,
      candidates_inserted: 0,
      total_cost_usd: 0,
      notes: `No city eligible — all scouted within ${COOLDOWN_DAYS}d`,
    })
    return
  }
  log(`   Target: ${target.city}${target.neighborhood ? ` / ${target.neighborhood}` : ''} (priority ${target.priority_score})`)

  const runId = await startRun(db, target)
  let cost = 0
  let examined = 0
  let inserted = 0
  let finalStatus: RunStatus = 'success'
  let errorMessage: string | null = null
  // What the per-run cap can still absorb — also clamped by the daily
  // headroom so we don't blow the $3/day ceiling on a single run.
  const remainingRunBudget = () =>
    Math.min(PER_RUN_CAP_USD - cost, DAILY_CAP_USD - dailySpend - cost)

  try {
    // ── Search ────────────────────────────────────────────
    const seen = new Set<string>()
    const candidates: GPPlace[] = []

    for (const template of SEARCH_QUERY_TEMPLATES) {
      if (remainingRunBudget() < COST.textSearch) {
        log(`   ⏸ Stopping searches — remaining budget $${remainingRunBudget().toFixed(4)} < text search cost`)
        finalStatus = 'cap_hit'
        break
      }
      const q = buildSearchQuery(template, target)
      log(`   🔍 ${q}`)
      try {
        const results = await textSearch(q, {
          lat: target.lat ?? undefined,
          lng: target.lng ?? undefined,
          radiusMeters: target.radius_meters ?? 25000,
          maxResults: 20,
        })
        cost += COST.textSearch
        let added = 0
        for (const p of results) {
          if (!seen.has(p.id)) {
            seen.add(p.id)
            candidates.push(p)
            added++
          }
        }
        log(`     → ${results.length} results, ${added} new (pool: ${candidates.length})`)
      } catch (err) {
        log(`     ⚠ search error: ${err instanceof Error ? err.message : String(err)}`)
      }
      await sleep(150)
    }

    // ── Dedupe against spots.google_place_id ─────────────
    const existing = await findExistingPlaceIds(db, candidates.map((p) => p.id))
    const newCandidates = candidates.filter((p) => !existing.has(p.id)).slice(0, MAX_CANDIDATES_PER_RUN)
    log(`   📦 ${newCandidates.length} new candidate(s) after dedup (skipped ${existing.size} known)`)

    // ── Per-candidate details + insert ───────────────────
    const rowsToInsert: ReturnType<typeof placeToScoutRow>[] = []

    for (const place of newCandidates) {
      if (remainingRunBudget() < COST.placeDetails) {
        log(`   ⏸ Cost cap reached during enrichment — stopping after $${cost.toFixed(4)}.`)
        finalStatus = finalStatus === 'success' ? 'partial' : finalStatus
        break
      }
      examined++
      const name = place.displayName?.text ?? place.id
      try {
        const details = await getPlaceDetails(place.id)
        cost += COST.placeDetails
        const row = placeToScoutRow(details, target)
        rowsToInsert.push(row)
        log(`     [${examined}/${newCandidates.length}] ${name} → ${row.type}`)
      } catch (err) {
        log(`     [${examined}/${newCandidates.length}] ${name} → ⚠ details error: ${err instanceof Error ? err.message : String(err)}`)
      }
      await sleep(180)
    }

    // ── Insert batch ─────────────────────────────────────
    if (rowsToInsert.length > 0) {
      if (isDryRun) {
        log(`\n── DRY RUN: would insert ${rowsToInsert.length} rows ──`)
        log(JSON.stringify(rowsToInsert, null, 2))
        inserted = rowsToInsert.length
      } else {
        // Use upsert with ignoreDuplicates so a race (Scout vs. a
        // manual import that fires at the same time) just no-ops
        // instead of throwing on the unique index.
        const { data, error } = await db
          .from('spots')
          .upsert(rowsToInsert, { onConflict: 'google_place_id', ignoreDuplicates: true })
          .select('id')
        if (error) {
          log(`   ⚠ Insert error: ${error.message}`)
          finalStatus = 'error'
          errorMessage = error.message
        } else {
          inserted = data?.length ?? 0
        }
      }
    }
  } catch (err) {
    finalStatus = 'error'
    errorMessage = err instanceof Error ? err.message : String(err)
    log(`   💥 ${errorMessage}`)
  }

  // ── Update last_scouted_at even on partial runs — we did
  //    spend the budget, no point re-hammering the same city
  //    immediately on the next cron tick. On 'error' we leave
  //    it so the next run retries.
  if (finalStatus !== 'error') {
    await markScouted(db, target.id)
  }

  // ── Close out the run ─────────────────────────────────────
  await finishRun(db, runId, {
    status: finalStatus,
    candidates_examined: examined,
    candidates_inserted: inserted,
    total_cost_usd: cost,
    error_message: errorMessage,
    notes: `Target: ${target.city}${target.neighborhood ? ` / ${target.neighborhood}` : ''}`,
  })

  log(`\n   ✅ Run complete`)
  log(`      Status:    ${finalStatus}`)
  log(`      Examined:  ${examined}`)
  log(`      Inserted:  ${inserted}`)
  log(`      Cost:      $${cost.toFixed(4)}`)
  log(`      24h total: $${(dailySpend + cost).toFixed(4)} / $${DAILY_CAP_USD.toFixed(2)}\n`)
}

main().catch((err) => {
  log(`\n💥 Fatal: ${err.message}`)
  process.exit(1)
})
