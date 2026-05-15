/**
 * WorkSpot — NYC Master Import Script
 *
 * Searches Google Places for laptop-friendly work spots across NYC,
 * pulls reviews to generate scores, and upserts into Supabase.
 *
 * Usage:
 *   npx tsx scripts/import-nyc.ts
 *
 * Flags:
 *   --dry-run      Print results as JSON without writing to DB
 *   --limit=N      Max spots to import (default: 200)
 *   --output=FILE  Write results to a JSON file instead of Supabase
 */

import {
  textSearch,
  getPlaceDetails,
  convertHours,
  mapPlaceType,
  scoreFromReviews,
  noiseLevelFromText,
  seatingComfortFromData,
  vibeTagsFromPlace,
  photoUrlRedirect,
  GPPlace,
} from '../src/lib/google-places'
import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'

// ── Config ────────────────────────────────────────────────────

const isDryRun = process.argv.includes('--dry-run')
const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const outputArg = process.argv.find((a) => a.startsWith('--output='))
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1]) : 200
const OUTPUT_FILE = outputArg ? outputArg.split('=')[1] : null

// Load env vars
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
    // .env.local not found, use existing process.env
  }
}

loadEnv()

const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY ?? ''
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

// ── NYC Search Queries ────────────────────────────────────────
//
// Intentionally broad — we deduplicate by place_id.
// Covers: coffee shops, diners, hotel lobbies, bars, 24hr spots.

const NYC_CENTER = { lat: 40.7128, lng: -74.0060 }

const SEARCH_QUERIES = [
  // ── Hotel lobbies & lobby cafes (FRONT-LOADED) ──
  // These are a core differentiator — nice hotel lobbies often have great
  // coffee + are quiet enough to lounge/work. Putting them first ensures
  // they don't get crowded out by the LIMIT ceiling.
  'hotel lobby cafe Manhattan',
  'boutique hotel lobby Manhattan work',
  'luxury hotel lobby coffee New York',
  'hotel lobby with seating New York work',
  'hotel bar lounge Manhattan laptop',
  'hotel lobby Brooklyn',
  'hotel lobby SoHo',
  'hotel lobby Lower East Side',
  'hotel lobby Williamsburg',
  'hotel lobby Tribeca',

  // ── 24-hour spots ──
  '24 hour coffee shop New York City',
  'open all night cafe New York',
  '24 hour diner Manhattan',

  // ── Coffee / cafes by area ──
  'coffee shop laptop friendly Manhattan',
  'coffee shop open late Brooklyn',
  'cafe wifi New York City',
  'coffee shop Williamsburg Brooklyn',
  'cafe East Village New York',
  'coffee shop Astoria Queens',
  'cafe open late Greenwich Village',
  'coffee shop Lower East Side NYC',
  'cafe Chelsea Manhattan',
  'coffee shop Harlem NYC',
  'cafe SoHo New York',
  'cafe Midtown Manhattan laptop',
  'coffee shop open late Bushwick',
  'cafe open late Park Slope Brooklyn',

  // ── Diners / late night food ──
  'late night diner New York City',
  'diner open late Manhattan',
  '24 hour diner Brooklyn',

  // ── Bars with laptop vibe ──
  'quiet bar laptop New York City',
  'wine bar work New York',
]

// ── Helpers ───────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function log(msg: string) {
  process.stdout.write(msg + '\n')
}

// ── Place → DB row conversion ─────────────────────────────────

interface SpotRow {
  name: string
  slug: string
  type: string
  address: string
  city: string
  neighborhood: string | null
  lat: number | null
  lng: number | null
  google_place_id: string
  photos: { url: string; caption: string }[]
  hours: Record<string, { open: string; close: string } | null> | null
  work_score: number
  late_night_score: number
  wifi_score: number
  outlet_score: number
  noise_score: number
  seating_score: number
  has_wifi: boolean
  has_outlets: boolean
  laptop_friendly: boolean
  has_bathroom: boolean
  has_food: boolean
  has_drinks: boolean
  noise_level: string
  seating_comfort: string
  vibe_tags: string[]
  notes: string
  status: string
}

function extractNeighborhood(address: string): string | null {
  // Common NYC neighborhoods to detect in address
  const neighborhoods = [
    'Greenwich Village', 'East Village', 'West Village', 'SoHo', 'NoHo', 'Tribeca',
    'Lower East Side', 'Chinatown', 'Nolita', 'Little Italy', 'Financial District',
    'Flatiron', 'Gramercy', 'Murray Hill', 'Kip\'s Bay', 'Hell\'s Kitchen',
    'Chelsea', 'Midtown', 'Upper West Side', 'Upper East Side', 'Harlem',
    'Washington Heights', 'Inwood', 'Williamsburg', 'Bushwick', 'Greenpoint',
    'Park Slope', 'DUMBO', 'Brooklyn Heights', 'Cobble Hill', 'Carroll Gardens',
    'Crown Heights', 'Bed-Stuy', 'Flatbush', 'Bay Ridge', 'Astoria', 'Long Island City',
    'Jackson Heights', 'Flushing', 'Jamaica', 'Sunnyside',
  ]

  for (const n of neighborhoods) {
    if (address.toLowerCase().includes(n.toLowerCase())) return n
  }
  return null
}

function cityFromAddress(address: string): string {
  if (address.includes('Brooklyn') || address.includes('NY 112')) return 'New York City'
  if (address.includes('Queens') || address.includes('Astoria') || address.includes('Flushing')) return 'New York City'
  if (address.includes('Bronx')) return 'New York City'
  if (address.includes('Staten Island')) return 'New York City'
  if (address.includes('New York')) return 'New York City'
  return 'New York City'
}

function placeToSpotRow(place: GPPlace, scores: ReturnType<typeof scoreFromReviews>): SpotRow {
  const reviews = place.reviews ?? []
  const allReviewText = reviews.map((r) => r.text?.text ?? '').join(' ')

  const hours = convertHours(place.regularOpeningHours)
  const photos = (place.photos ?? [])
    .slice(0, 4)
    .map((p, i) => ({
      url: photoUrlRedirect(p.name, 800),
      caption: i === 0 ? 'Main' : `Photo ${i + 1}`,
    }))

  const name = place.displayName?.text ?? 'Unknown'
  const address = place.formattedAddress ?? ''
  const city = cityFromAddress(address)
  const neighborhood = extractNeighborhood(address)

  const slug = `${slugify(name)}-${slugify(city === 'New York City' ? 'nyc' : city)}-${place.id.slice(-6)}`

  const type = mapPlaceType(place.types ?? [])

  // Infer amenities from reviews + type
  const reviewLower = allReviewText.toLowerCase()
  const has_wifi = reviewLower.includes('wifi') || reviewLower.includes('wi-fi') || type === 'coffee_shop' || type === 'hotel_lobby'
  const has_outlets = reviewLower.includes('outlet') || reviewLower.includes('charging') || reviewLower.includes('plug')
  const has_food = type === 'diner' || type === 'bar' || reviewLower.includes('food') || reviewLower.includes('menu')
  const has_drinks = type !== 'library'
  const laptop_friendly = scores.work_score >= 5.5

  const noise_level = noiseLevelFromText(allReviewText)
  const seating_comfort = seatingComfortFromData(reviews, place.priceLevel)
  const vibe_tags = vibeTagsFromPlace(place, reviews)

  // Build notes from editorial summary or top review
  const notes =
    place.editorialSummary?.text ??
    (reviews[0]?.text?.text?.slice(0, 280) ?? '')

  return {
    name,
    slug,
    type,
    address,
    city,
    neighborhood,
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    google_place_id: place.id,
    photos,
    hours,
    work_score: scores.work_score,
    late_night_score: scores.late_night_score,
    wifi_score: scores.wifi_score,
    outlet_score: scores.outlet_score,
    noise_score: scores.noise_score,
    seating_score: scores.seating_score,
    has_wifi,
    has_outlets,
    laptop_friendly,
    has_bathroom: type !== 'other',
    has_food,
    has_drinks,
    noise_level,
    seating_comfort,
    vibe_tags,
    notes,
    // All imported candidates start as 'pending' — they only become 'approved'
    // after you verify them in person via the /admin dashboard. This is the
    // moat: the public site shows only verified rows.
    status: 'pending',
  }
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  if (!GOOGLE_KEY || GOOGLE_KEY.includes('placeholder')) {
    log('❌ GOOGLE_PLACES_API_KEY is not set in .env.local')
    log('   Get a key at: https://console.cloud.google.com → Enable "Places API (New)"')
    process.exit(1)
  }

  if (!isDryRun && !OUTPUT_FILE) {
    if (!SUPABASE_URL || SUPABASE_URL.includes('placeholder') || !SUPABASE_SERVICE_KEY || SUPABASE_SERVICE_KEY.includes('placeholder')) {
      log('❌ Supabase credentials not set. Use --dry-run or --output=spots.json to test without DB.')
      log('   Or fill in NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local')
      process.exit(1)
    }
  }

  log(`\n☕ WorkSpot — NYC Google Places Import`)
  log(`   Mode: ${isDryRun ? 'DRY RUN' : OUTPUT_FILE ? `→ ${OUTPUT_FILE}` : '→ Supabase'}`)
  log(`   Limit: ${LIMIT} spots`)
  log(`   Queries: ${SEARCH_QUERIES.length}\n`)

  // ── Step 1: Collect all place IDs via text search ─────────

  const seenIds = new Set<string>()
  const placesToFetch: GPPlace[] = []

  for (const query of SEARCH_QUERIES) {
    if (placesToFetch.length >= LIMIT) break

    log(`  🔍 Searching: "${query}"`)

    try {
      const results = await textSearch(query, {
        lat: NYC_CENTER.lat,
        lng: NYC_CENTER.lng,
        radiusMeters: 35000,
        maxResults: 20,
      })

      let newCount = 0
      for (const place of results) {
        if (!seenIds.has(place.id) && placesToFetch.length < LIMIT) {
          seenIds.add(place.id)
          placesToFetch.push(place)
          newCount++
        }
      }

      log(`     → ${results.length} results, ${newCount} new (total: ${placesToFetch.length})`)
    } catch (err) {
      log(`     ⚠ Error: ${err instanceof Error ? err.message : String(err)}`)
    }

    // Rate limit: 100ms between searches
    await sleep(100)
  }

  log(`\n  📦 ${placesToFetch.length} unique places to enrich with reviews...\n`)

  // ── Step 2: Fetch full details + reviews for each place ───

  const spots: SpotRow[] = []

  for (let i = 0; i < placesToFetch.length; i++) {
    const place = placesToFetch[i]
    const name = place.displayName?.text ?? place.id

    process.stdout.write(`  [${i + 1}/${placesToFetch.length}] ${name}... `)

    try {
      const details = await getPlaceDetails(place.id)
      const scores = scoreFromReviews(details.reviews ?? [], details)
      const row = placeToSpotRow(details, scores)

      spots.push(row)
      log(`✓ (work: ${row.work_score}, night: ${row.late_night_score}, ${row.type})`)
    } catch (err) {
      log(`⚠ skipped — ${err instanceof Error ? err.message : String(err)}`)
    }

    // Rate limit: 200ms between detail fetches
    await sleep(200)
  }

  log(`\n  ✅ Processed ${spots.length} spots\n`)

  // ── Step 3: Output ────────────────────────────────────────

  if (isDryRun) {
    log('── DRY RUN OUTPUT ──────────────────────────────────────────')
    log(JSON.stringify(spots, null, 2))
    return
  }

  if (OUTPUT_FILE) {
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(spots, null, 2))
    log(`📁 Written to ${OUTPUT_FILE}`)
    return
  }

  // ── Step 4: Upsert into Supabase ──────────────────────────

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  log(`  💾 Upserting ${spots.length} spots into Supabase...`)

  let inserted = 0
  let updated = 0
  let errors = 0

  // Upsert in batches of 20
  const BATCH = 20
  for (let i = 0; i < spots.length; i += BATCH) {
    const batch = spots.slice(i, i + BATCH)
    const { data, error } = await db
      .from('spots')
      .upsert(batch, { onConflict: 'google_place_id', ignoreDuplicates: false })
      .select('id')

    if (error) {
      log(`  ⚠ Batch ${Math.floor(i / BATCH) + 1} error: ${error.message}`)
      errors += batch.length
    } else {
      inserted += data?.length ?? 0
    }
  }

  log(`\n  ✅ Done!`)
  log(`     Upserted: ${inserted}`)
  log(`     Errors:   ${errors}`)
  log(`\n  View your spots at http://localhost:3000/admin\n`)
}

main().catch((err) => {
  log(`\n💥 Fatal error: ${err.message}`)
  process.exit(1)
})
