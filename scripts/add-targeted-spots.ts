/**
 * Targeted spot adder — for spots you specifically want in the DB rather
 * than waiting for Scout to discover them in its rotation.
 *
 * Hardcodes a list of (search query, expected neighborhood) tuples,
 * runs each through Google Places Text Search, picks the top result,
 * fetches details + reviews, inserts as approved.
 *
 * Differs from Scout in three ways:
 *   1. Targeted (specific names you give it) instead of broad neighborhood sweep
 *   2. Inserts as status='approved' directly (you've already vouched for these)
 *   3. No cost cap — meant for one-shot operator use, not scheduled runs
 *
 * Usage:
 *   npx tsx scripts/add-targeted-spots.ts
 *   npx tsx scripts/add-targeted-spots.ts --dry-run
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import {
  textSearch,
  getPlaceDetails,
  convertHours,
  mapPlaceType,
  noiseLevelFromText,
  seatingComfortFromData,
  vibeTagsFromPlace,
  photoUrlRedirect,
} from '../src/lib/google-places'

// ── The list ──────────────────────────────────────────────────
// Edit this list and re-run to add more spots.

const SPOTS: Array<{
  query: string
  neighborhood: string
  city: string
}> = [
  { query: 'Blue Bottle Coffee Williamsburg Brooklyn', neighborhood: 'Williamsburg', city: 'New York City' },
  { query: 'Variety Coffee Roasters Park Slope Brooklyn', neighborhood: 'Park Slope', city: 'New York City' },
  { query: 'Elk Cafe West Village New York', neighborhood: 'West Village', city: 'New York City' },
]

// ── Setup ─────────────────────────────────────────────────────

const args = process.argv.slice(2)
const isDryRun = args.includes('--dry-run')

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env.local')
  try {
    const raw = fs.readFileSync(envPath, 'utf-8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const val = trimmed.slice(eq + 1).trim()
      if (key && !(key in process.env)) process.env[key] = val
    }
  } catch {
    /* fall back to ambient env */
  }
}

loadEnv()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[add-targeted] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}
if (!process.env.GOOGLE_PLACES_API_KEY && !process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY) {
  console.error('[add-targeted] Missing GOOGLE_PLACES_API_KEY (or NEXT_PUBLIC_ variant).')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── slug helper ───────────────────────────────────────────────

function slugify(name: string, neighborhood: string): string {
  const base = `${name}-${neighborhood}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return base.slice(0, 80)
}

// ── main ──────────────────────────────────────────────────────

async function main() {
  console.log(`[add-targeted] Starting. dry-run=${isDryRun}\n`)

  for (const target of SPOTS) {
    console.log(`── ${target.query}`)

    // 1. Search for the place
    let candidates
    try {
      candidates = await textSearch({ query: target.query })
    } catch (e) {
      console.error(`  ✗ textSearch failed: ${(e as Error).message}`)
      continue
    }
    if (!candidates || candidates.length === 0) {
      console.error(`  ✗ no results from Google for "${target.query}"`)
      continue
    }

    const top = candidates[0]
    console.log(`  → matched: ${top.displayName?.text ?? '(no name)'} @ ${top.formattedAddress ?? '(no address)'}`)

    // 2. Dedupe by google_place_id
    const { data: existing } = await supabase
      .from('spots')
      .select('id, name, status')
      .eq('google_place_id', top.id)
      .maybeSingle()

    if (existing) {
      console.log(`  ↻ already in DB as "${existing.name}" (${existing.status})`)
      if (existing.status !== 'approved') {
        if (isDryRun) {
          console.log(`  (dry-run) would approve`)
        } else {
          await supabase
            .from('spots')
            .update({ status: 'approved', last_verified_at: new Date().toISOString() })
            .eq('id', existing.id)
          console.log(`  ✓ approved`)
        }
      }
      continue
    }

    // 3. Fetch full details + reviews
    let details
    try {
      details = await getPlaceDetails(top.id)
    } catch (e) {
      console.error(`  ✗ getPlaceDetails failed: ${(e as Error).message}`)
      continue
    }

    // 4. Build the spot row
    const reviews = details.reviews ?? []
    const reviewText = reviews.map((r) => r.text?.text ?? '').join(' ')
    const firstReviewExcerpt = reviews[0]?.text?.text?.slice(0, 800) ?? ''

    const name = details.displayName?.text ?? top.displayName?.text ?? target.query
    const slug = slugify(name, target.neighborhood)

    const row: Record<string, unknown> = {
      name,
      slug,
      type: mapPlaceType(details.types ?? []),
      address: details.formattedAddress ?? '',
      city: target.city,
      neighborhood: target.neighborhood,
      lat: details.location?.latitude ?? null,
      lng: details.location?.longitude ?? null,
      google_place_id: details.id,
      photos: (details.photos ?? []).slice(0, 5).map((p) => ({
        url: photoUrlRedirect(p.name, 800),
      })),
      hours: convertHours(details.regularOpeningHours),
      has_wifi: true,
      has_outlets: false,
      laptop_friendly: true,
      has_bathroom: true,
      has_food: true,
      has_drinks: true,
      noise_level: noiseLevelFromText(reviewText),
      seating_comfort: seatingComfortFromData(reviews, details.types ?? []),
      vibe_tags: vibeTagsFromPlace(details, reviews),
      notes: firstReviewExcerpt,
      status: 'approved',
      submitted_by: 'add-targeted-spots',
      last_verified_at: new Date().toISOString(),
    }

    if (isDryRun) {
      console.log(`  (dry-run) would insert: ${JSON.stringify({ name: row.name, neighborhood: row.neighborhood, place_id: row.google_place_id }, null, 2)}`)
      continue
    }

    const { error } = await supabase.from('spots').insert(row)
    if (error) {
      console.error(`  ✗ insert failed: ${error.message}`)
      continue
    }
    console.log(`  ✓ inserted as approved`)
  }

  console.log(`\n[add-targeted] Done. Run \`npx tsx scripts/curate-workability.ts\` to score the new spots.`)
}

main().catch((e) => {
  console.error('[add-targeted] FATAL:', e)
  process.exit(1)
})
