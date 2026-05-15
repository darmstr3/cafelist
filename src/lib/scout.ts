/**
 * Scout Agent — core run loop.
 *
 * Shared between scripts/scout.ts (CLI) and src/app/api/scout/route.ts
 * (HTTP entrypoint for the scheduled task). Keeping the logic in one
 * place stops the two from drifting apart on cost caps, query templates,
 * etc.
 *
 * See scripts/scout.ts for the design doc / pricing assumptions.
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
} from './google-places'
import type { SupabaseClient } from '@supabase/supabase-js'

// ── Tunable constants ─────────────────────────────────────────

// Conservative Google Places (New) per-call estimates. Bump these
// if Google reprices — they're used to throttle, not to bill, so
// over-estimating just means slightly less per run.
export const COST = {
  textSearch: 0.032,    // Text Search Basic SKU
  placeDetails: 0.017,  // Place Details (Pro) — includes reviews
}

export const PER_RUN_CAP_USD = 0.50
export const DAILY_CAP_USD = 3.00
export const COOLDOWN_DAYS = 7
export const MAX_CANDIDATES_PER_RUN = 25

export const SEARCH_QUERY_TEMPLATES = ['coffee shop', 'cafe', 'hotel lobby']

// ── Types ─────────────────────────────────────────────────────

export interface PriorityRow {
  id: string
  city: string
  neighborhood: string | null
  priority_score: number
  last_scouted_at: string | null
  lat: number | null
  lng: number | null
  radius_meters: number | null
}

export type RunStatus = 'running' | 'success' | 'partial' | 'skipped' | 'error' | 'cap_hit'

export interface ScoutResult {
  status: RunStatus
  run_id: string | null
  target: { city: string; neighborhood: string | null } | null
  candidates_examined: number
  candidates_inserted: number
  total_cost_usd: number
  daily_spend_before: number
  daily_spend_after: number
  error_message?: string | null
  notes?: string | null
  /** When dryRun=true, the rows that *would* have been inserted. */
  preview?: ReturnType<typeof placeToScoutRow>[]
}

export interface ScoutOptions {
  dryRun?: boolean
  /** Optional override: skip the priority queue and target this city directly. */
  forcedCity?: string | null
  /** Override the per-run cap (e.g. for manual admin-triggered "deep scout" runs). */
  perRunCapUsd?: number
  /** Override the daily cap. Mostly for tests. */
  dailyCapUsd?: number
  logger?: (msg: string) => void
}

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
  const parts = [template]
  if (target.neighborhood) parts.push(target.neighborhood)
  parts.push(target.city)
  return parts.join(' ')
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Place → spot row (Scout's flavor: NO scoring) ────────────

export function placeToScoutRow(place: GPPlace, target: PriorityRow) {
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
    has_wifi:
      reviewLower.includes('wifi') ||
      reviewLower.includes('wi-fi') ||
      type === 'coffee_shop' ||
      type === 'hotel_lobby',
    has_outlets:
      reviewLower.includes('outlet') ||
      reviewLower.includes('charging') ||
      reviewLower.includes('plug'),
    laptop_friendly: reviewLower.includes('laptop') || reviewLower.includes('work'),
    has_bathroom: type !== 'other',
    has_food:
      type === 'diner' ||
      type === 'bar' ||
      reviewLower.includes('food') ||
      reviewLower.includes('menu'),
    has_drinks: type !== 'library',
    noise_level: noiseLevelFromText(allReviewText),
    seating_comfort: seatingComfortFromData(reviews, place.priceLevel),
    vibe_tags: vibeTagsFromPlace(place, reviews),
    notes,
    // Score columns intentionally omitted — Curator owns them.
    status: 'pending' as const,
    submitted_by: 'scout-agent',
  }
}

// ── DB helpers ────────────────────────────────────────────────

async function readDailySpend(
  db: SupabaseClient,
  log: (m: string) => void,
): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await db
    .from('scout_runs')
    .select('total_cost_usd')
    .gte('started_at', since)
  if (error) {
    log(`  ⚠ Couldn't read daily spend (${error.message}) — defaulting to $0`)
    return 0
  }
  return (data ?? []).reduce(
    (s, r: { total_cost_usd: number | string }) => s + Number(r.total_cost_usd ?? 0),
    0,
  )
}

async function pickNextCity(
  db: SupabaseClient,
  forcedCity: string | null,
  log: (m: string) => void,
): Promise<PriorityRow | null> {
  if (forcedCity) {
    const { data, error } = await db
      .from('scout_priority')
      .select('*')
      .eq('city', forcedCity)
      .order('priority_score', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) {
      log(`  ⚠ forcedCity lookup error: ${error.message}`)
      return null
    }
    return (data as PriorityRow) ?? null
  }

  const cutoff = new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString()
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

async function findExistingPlaceIds(
  db: SupabaseClient,
  ids: string[],
  log: (m: string) => void,
): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const { data, error } = await db
    .from('spots')
    .select('google_place_id')
    .in('google_place_id', ids)
  if (error) {
    log(`  ⚠ dedup query error: ${error.message}`)
    return new Set()
  }
  return new Set(
    (data ?? []).map((r: { google_place_id: string }) => r.google_place_id),
  )
}

async function startRun(
  db: SupabaseClient,
  target: PriorityRow | null,
  dryRun: boolean,
  log: (m: string) => void,
): Promise<string | null> {
  if (dryRun) return null
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
  dryRun: boolean,
  log: (m: string) => void,
) {
  if (dryRun || !runId) return
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

async function markScouted(
  db: SupabaseClient,
  priorityId: string,
  dryRun: boolean,
  log: (m: string) => void,
) {
  if (dryRun) return
  const { error } = await db
    .from('scout_priority')
    .update({ last_scouted_at: new Date().toISOString() })
    .eq('id', priorityId)
  if (error) log(`  ⚠ Couldn't update last_scouted_at: ${error.message}`)
}

// ── Main run loop ─────────────────────────────────────────────

export async function runScout(
  db: SupabaseClient,
  options: ScoutOptions = {},
): Promise<ScoutResult> {
  const dryRun = options.dryRun ?? false
  const forcedCity = options.forcedCity ?? null
  const perRunCap = options.perRunCapUsd ?? PER_RUN_CAP_USD
  const dailyCap = options.dailyCapUsd ?? DAILY_CAP_USD
  const log = options.logger ?? (() => {})

  const result: ScoutResult = {
    status: 'running',
    run_id: null,
    target: null,
    candidates_examined: 0,
    candidates_inserted: 0,
    total_cost_usd: 0,
    daily_spend_before: 0,
    daily_spend_after: 0,
    error_message: null,
    notes: null,
  }

  // ── Daily cap ─────────────────────────────────────────────
  if (!dryRun) {
    result.daily_spend_before = await readDailySpend(db, log)
    if (result.daily_spend_before >= dailyCap) {
      log(`   ⛔ Daily cap reached ($${result.daily_spend_before.toFixed(4)}). Skipping.`)
      const runId = await startRun(db, null, dryRun, log)
      result.run_id = runId
      result.status = 'skipped'
      result.notes = `Daily cap hit ($${result.daily_spend_before.toFixed(4)} / $${dailyCap.toFixed(2)})`
      await finishRun(
        db,
        runId,
        {
          status: 'skipped',
          candidates_examined: 0,
          candidates_inserted: 0,
          total_cost_usd: 0,
          notes: result.notes,
        },
        dryRun,
        log,
      )
      result.daily_spend_after = result.daily_spend_before
      return result
    }
  }

  // ── Pick a city ───────────────────────────────────────────
  const target = await pickNextCity(db, forcedCity, log)
  if (!target) {
    log(`   ⛔ No eligible city found. Skipping.`)
    const runId = await startRun(db, null, dryRun, log)
    result.run_id = runId
    result.status = 'skipped'
    result.notes = forcedCity
      ? `forcedCity '${forcedCity}' not in scout_priority`
      : `All cities scouted within ${COOLDOWN_DAYS}d`
    await finishRun(
      db,
      runId,
      {
        status: 'skipped',
        candidates_examined: 0,
        candidates_inserted: 0,
        total_cost_usd: 0,
        notes: result.notes,
      },
      dryRun,
      log,
    )
    result.daily_spend_after = result.daily_spend_before
    return result
  }
  result.target = { city: target.city, neighborhood: target.neighborhood }
  log(
    `   Target: ${target.city}${target.neighborhood ? ` / ${target.neighborhood}` : ''} (priority ${target.priority_score})`,
  )

  const runId = await startRun(db, target, dryRun, log)
  result.run_id = runId

  let cost = 0
  let finalStatus: RunStatus = 'success'
  let errorMessage: string | null = null
  const previewRows: ReturnType<typeof placeToScoutRow>[] = []

  const remainingRunBudget = () =>
    Math.min(perRunCap - cost, dailyCap - result.daily_spend_before - cost)

  try {
    // ── Search ─────────────────────────────────────────────
    const seen = new Set<string>()
    const candidates: GPPlace[] = []

    for (const template of SEARCH_QUERY_TEMPLATES) {
      if (remainingRunBudget() < COST.textSearch) {
        log(
          `   ⏸ Stopping searches — remaining budget $${remainingRunBudget().toFixed(4)} < text search cost`,
        )
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
    const existing = await findExistingPlaceIds(db, candidates.map((p) => p.id), log)
    const newCandidates = candidates
      .filter((p) => !existing.has(p.id))
      .slice(0, MAX_CANDIDATES_PER_RUN)
    log(
      `   📦 ${newCandidates.length} new candidate(s) after dedup (skipped ${existing.size} known)`,
    )

    // ── Enrich ───────────────────────────────────────────
    const rowsToInsert: ReturnType<typeof placeToScoutRow>[] = []
    for (const place of newCandidates) {
      if (remainingRunBudget() < COST.placeDetails) {
        log(`   ⏸ Cost cap reached during enrichment — stopping after $${cost.toFixed(4)}.`)
        finalStatus = finalStatus === 'success' ? 'partial' : finalStatus
        break
      }
      result.candidates_examined++
      const name = place.displayName?.text ?? place.id
      try {
        const details = await getPlaceDetails(place.id)
        cost += COST.placeDetails
        const row = placeToScoutRow(details, target)
        rowsToInsert.push(row)
        log(`     [${result.candidates_examined}] ${name} → ${row.type}`)
      } catch (err) {
        log(
          `     [${result.candidates_examined}] ${name} → ⚠ details error: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      await sleep(180)
    }

    // ── Insert ───────────────────────────────────────────
    if (rowsToInsert.length > 0) {
      if (dryRun) {
        log(`   (dry-run) would insert ${rowsToInsert.length} rows`)
        previewRows.push(...rowsToInsert)
        result.candidates_inserted = rowsToInsert.length
      } else {
        const { data, error } = await db
          .from('spots')
          .upsert(rowsToInsert, { onConflict: 'google_place_id', ignoreDuplicates: true })
          .select('id')
        if (error) {
          log(`   ⚠ Insert error: ${error.message}`)
          finalStatus = 'error'
          errorMessage = error.message
        } else {
          result.candidates_inserted = data?.length ?? 0
        }
      }
    }
  } catch (err) {
    finalStatus = 'error'
    errorMessage = err instanceof Error ? err.message : String(err)
    log(`   💥 ${errorMessage}`)
  }

  // Don't reset last_scouted_at on hard errors — let the next tick retry.
  if (finalStatus !== 'error') {
    await markScouted(db, target.id, dryRun, log)
  }

  result.total_cost_usd = cost
  result.status = finalStatus
  result.error_message = errorMessage
  result.notes = `Target: ${target.city}${target.neighborhood ? ` / ${target.neighborhood}` : ''}`
  result.daily_spend_after = result.daily_spend_before + cost
  if (dryRun) result.preview = previewRows

  await finishRun(
    db,
    runId,
    {
      status: finalStatus,
      candidates_examined: result.candidates_examined,
      candidates_inserted: result.candidates_inserted,
      total_cost_usd: cost,
      error_message: errorMessage,
      notes: result.notes,
    },
    dryRun,
    log,
  )

  return result
}
