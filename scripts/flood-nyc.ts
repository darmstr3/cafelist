// ─────────────────────────────────────────────────────────────
// scripts/flood-nyc.ts
//
// One-shot Google Places BULK IMPORT for NYC dense neighborhoods.
//
// Why this exists (May 25 product call): the /labs agent kept showing
// 1-2 thin results because the DB only had ~140 NYC coffee shops, and
// strict filters (workability ≥ 6, open after 9pm, type=coffee_shop)
// reduced that to almost nothing in many neighborhoods. The Curator +
// trap-detector machinery is good enough to filter quality. The
// constraint is QUANTITY — so this script floods the DB with every
// coffee_shop / cafe Google Places knows about in 28 dense NYC
// neighborhoods, runs the high-confidence trap detectors against each
// candidate, and inserts the survivors as status='pending' so the
// daily Curator can score them on its next run.
//
// This script intentionally bypasses Scout's priority queue + cooldown.
// It is meant to be run ONCE (or rarely) as a backfill, not on a
// schedule. Scout continues to handle the ongoing trickle.
//
// ── Cost
//   ~2 text searches/neighborhood × 28 neighborhoods × $0.032 = $1.80
//   ~15 details/neighborhood × 28 × $0.017                     = $7.14
//   Hard cap default $15, override with --cap=N.
//
// ── Trap pre-screen
// Reuses the rules in src/lib/labs/trap-detectors.ts. We run every
// detector whose action is 'reject' OR (action='flag_downgrade' AND
// confidence='high') as a HARD REJECT before insert. 'prompt_human'
// and lower-confidence flags pass through so a human (or Curator)
// makes the final call.
//
// ── Usage
//   npx tsx scripts/flood-nyc.ts                  # live, $15 cap
//   npx tsx scripts/flood-nyc.ts --dry-run        # no DB writes
//   npx tsx scripts/flood-nyc.ts --cap=30         # raise cost cap
//   npx tsx scripts/flood-nyc.ts --skip-trap      # disable pre-screen
//
// Run LOCALLY — your machine talks to Google Places + Supabase
// directly. Vercel/sandbox proxies block both.
// ─────────────────────────────────────────────────────────────

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import {
  textSearch,
  getPlaceDetails,
  type GPPlace,
} from '../src/lib/google-places'
import { placeToScoutRow, COST, type PriorityRow } from '../src/lib/scout'
import {
  TRAP_DETECTORS,
  type DetectionSignal,
  type TrapDetector,
} from '../src/lib/labs/trap-detectors'

// ── Env loader (mirrors scripts/scout.ts) ─────────────────────
function loadEnv() {
  try {
    const raw = fs.readFileSync('.env.local', 'utf-8')
    for (const line of raw.split('\n')) {
      const [k, ...v] = line.split('=')
      if (k && !k.startsWith('#') && k.trim()) {
        process.env[k.trim()] = v.join('=').trim()
      }
    }
  } catch {
    // .env.local missing — rely on process.env
  }
}
loadEnv()

// ── Flags ─────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes('--dry-run')
const SKIP_TRAP = process.argv.includes('--skip-trap')
const COST_CAP_USD = (() => {
  const arg = process.argv.find((a) => a.startsWith('--cap='))
  if (!arg) return 15
  const n = Number(arg.split('=')[1])
  if (!Number.isFinite(n) || n <= 0) {
    console.error('--cap must be a positive number')
    process.exit(2)
  }
  return n
})()

// ── Targets ───────────────────────────────────────────────────
//
// 28 NYC neighborhoods chosen for density of coffee culture. Coords
// are rough centroids; radii are tuned so adjacent targets overlap
// slightly (dedupe will catch the spillover). Adding a target: pick
// a centroid + radius such that the circle covers the walkable core
// of the neighborhood without spilling more than ~20% into adjacent
// areas. Google Places returns a max of 20 per text search, so very
// large neighborhoods (e.g. Astoria, Bushwick) intentionally use
// larger radii to bias toward "dense café strips" rather than
// outlying residential.

const NYC_TARGETS: Array<{
  neighborhood: string
  lat: number
  lng: number
  radiusMeters: number
}> = [
  // Lower Manhattan
  { neighborhood: 'West Village', lat: 40.7355, lng: -74.003, radiusMeters: 800 },
  { neighborhood: 'East Village', lat: 40.7265, lng: -73.9817, radiusMeters: 800 },
  { neighborhood: 'Greenwich Village', lat: 40.7335, lng: -73.9975, radiusMeters: 800 },
  { neighborhood: 'SoHo', lat: 40.7233, lng: -74.003, radiusMeters: 800 },
  { neighborhood: 'NoHo', lat: 40.728, lng: -73.993, radiusMeters: 600 },
  { neighborhood: 'NoLita', lat: 40.722, lng: -73.995, radiusMeters: 500 },
  { neighborhood: 'Tribeca', lat: 40.7195, lng: -74.0083, radiusMeters: 800 },
  { neighborhood: 'Lower East Side', lat: 40.717, lng: -73.987, radiusMeters: 800 },
  { neighborhood: 'Chinatown', lat: 40.7158, lng: -73.997, radiusMeters: 700 },
  { neighborhood: 'Financial District', lat: 40.708, lng: -74.009, radiusMeters: 800 },

  // Midtown band
  { neighborhood: 'Chelsea', lat: 40.746, lng: -74.002, radiusMeters: 1000 },
  { neighborhood: 'Flatiron', lat: 40.741, lng: -73.9897, radiusMeters: 600 },
  { neighborhood: 'Gramercy', lat: 40.737, lng: -73.984, radiusMeters: 700 },
  { neighborhood: 'Murray Hill', lat: 40.748, lng: -73.978, radiusMeters: 700 },
  { neighborhood: 'Midtown', lat: 40.759, lng: -73.9845, radiusMeters: 1200 },
  { neighborhood: "Hell's Kitchen", lat: 40.7637, lng: -73.9918, radiusMeters: 900 },

  // Upper Manhattan
  { neighborhood: 'Upper West Side', lat: 40.787, lng: -73.9754, radiusMeters: 1500 },
  { neighborhood: 'Upper East Side', lat: 40.774, lng: -73.962, radiusMeters: 1500 },
  { neighborhood: 'Harlem', lat: 40.8116, lng: -73.9465, radiusMeters: 1500 },

  // North Brooklyn
  { neighborhood: 'Williamsburg', lat: 40.708, lng: -73.957, radiusMeters: 1500 },
  { neighborhood: 'Bushwick', lat: 40.694, lng: -73.921, radiusMeters: 1500 },
  { neighborhood: 'Greenpoint', lat: 40.727, lng: -73.953, radiusMeters: 1000 },
  { neighborhood: 'Bedford-Stuyvesant', lat: 40.687, lng: -73.941, radiusMeters: 1200 },
  { neighborhood: 'Park Slope', lat: 40.671, lng: -73.977, radiusMeters: 1000 },
  { neighborhood: 'DUMBO', lat: 40.703, lng: -73.9885, radiusMeters: 600 },
  { neighborhood: 'Fort Greene', lat: 40.69, lng: -73.9745, radiusMeters: 700 },

  // Queens
  { neighborhood: 'Long Island City', lat: 40.744, lng: -73.9485, radiusMeters: 1200 },
  { neighborhood: 'Astoria', lat: 40.764, lng: -73.9235, radiusMeters: 1500 },
]

// ── Trap pre-screen ───────────────────────────────────────────
//
// Runtime evaluator for the data-only TRAP_DETECTORS rules. Only
// handles signal kinds that work on a raw GPPlace (no spot_row yet
// because we're pre-insert). Skipped kinds: review_keyword (Scout
// joins reviews into spot.notes; not available before insert),
// attribute_check on spot_row, hours_check on spot_row.
//
// We could deepen this by reading reviews from the GPPlace.reviews
// array before insert — left as a future tightening pass.

function evalSignal(place: GPPlace, s: DetectionSignal): boolean {
  switch (s.kind) {
    case 'name_pattern': {
      const name = place.displayName?.text ?? ''
      try {
        return new RegExp(s.pattern, s.flags ?? 'i').test(name)
      } catch {
        return false
      }
    }
    case 'address_pattern': {
      const addr = place.formattedAddress ?? ''
      try {
        return new RegExp(s.pattern, s.flags ?? 'i').test(addr)
      } catch {
        return false
      }
    }
    case 'category_match': {
      if (s.source !== 'gp_raw') return false // spot_row not available pre-insert
      const types = place.types ?? []
      if (s.requireAll) return s.values.every((v) => types.includes(v))
      return s.values.some((v) => types.includes(v))
    }
    case 'metadata': {
      return (place as unknown as Record<string, unknown>)[s.field] === s.value
    }
    case 'composite': {
      if (s.op === 'and') return s.signals.every((sub) => evalSignal(place, sub))
      return s.signals.some((sub) => evalSignal(place, sub))
    }
    // review_keyword / attribute_check / hours_check rely on data we
    // don't have until after placeToScoutRow runs. Curator-time hook
    // (separate PR) catches these.
    default:
      return false
  }
}

function findRejectingTrap(place: GPPlace): TrapDetector | null {
  for (const d of TRAP_DETECTORS) {
    // Auto-reject envelope: explicit reject OR high-confidence
    // flag_downgrade. Anything below high-confidence flag, or
    // prompt_human, passes through to the DB so Curator + humans
    // see them.
    const shouldAutoReject =
      d.action === 'reject' ||
      (d.action === 'flag_downgrade' && d.confidence === 'high')
    if (!shouldAutoReject) continue
    if (d.signals.some((s) => evalSignal(place, s))) return d
  }
  return null
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    console.error('❌ GOOGLE_PLACES_API_KEY missing in .env.local')
    process.exit(1)
  }
  if (
    !DRY_RUN &&
    (!process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY)
  ) {
    console.error(
      '❌ Supabase env missing (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY). Use --dry-run to test without writes.'
    )
    process.exit(1)
  }

  const db: SupabaseClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'placeholder'
  )

  console.log(`\n🌊 NYC flood — bulk Google Places import`)
  console.log(`   ${NYC_TARGETS.length} target neighborhoods`)
  console.log(`   Cost cap:   $${COST_CAP_USD.toFixed(2)}`)
  console.log(`   Trap gate:  ${SKIP_TRAP ? 'DISABLED (--skip-trap)' : 'enabled'}`)
  console.log(`   Mode:       ${DRY_RUN ? 'DRY RUN — no writes' : 'LIVE'}\n`)

  // ── Pre-fetch existing place_ids to dedupe before we burn
  // API spend on places we already have. Single bulk read — small
  // enough to fit comfortably even at 100k+ rows.
  console.log('Loading existing place_ids…')
  const existingIds = new Set<string>()
  let from = 0
  for (;;) {
    const { data, error } = await db
      .from('spots')
      .select('google_place_id')
      .not('google_place_id', 'is', null)
      .range(from, from + 999)
    if (error) {
      console.error(`Failed to load existing rows: ${error.message}`)
      process.exit(1)
    }
    for (const r of data ?? []) {
      if (r.google_place_id) existingIds.add(r.google_place_id as string)
    }
    if (!data || data.length < 1000) break
    from += 1000
  }
  console.log(`   ${existingIds.size} existing place_ids — will skip duplicates\n`)

  // ── Search loop
  let costSoFar = 0
  let examined = 0
  let rejected = 0
  let inserted = 0
  const rejectionTally: Record<string, number> = {}
  const seenThisRun = new Set<string>()

  for (const target of NYC_TARGETS) {
    if (costSoFar >= COST_CAP_USD) {
      console.log(`💰 Cost cap reached ($${costSoFar.toFixed(4)} ≥ $${COST_CAP_USD.toFixed(2)}). Stopping.`)
      break
    }
    console.log(`📍 ${target.neighborhood}`)

    // 2 query templates per neighborhood — Google ranks by relevance
    // so a follow-up "cafe" pull picks up the ones the "coffee shop"
    // pull missed. Use the same locationBias circle to keep results
    // physically inside the neighborhood.
    const queries = [
      `coffee shop ${target.neighborhood} New York`,
      `cafe ${target.neighborhood} New York`,
    ]
    const localCandidates: GPPlace[] = []
    for (const q of queries) {
      if (costSoFar + COST.textSearch > COST_CAP_USD) break
      try {
        const places = await textSearch(q, {
          lat: target.lat,
          lng: target.lng,
          radiusMeters: target.radiusMeters,
          maxResults: 20,
        })
        costSoFar += COST.textSearch
        for (const p of places) {
          if (!p.id) continue
          if (existingIds.has(p.id) || seenThisRun.has(p.id)) continue
          seenThisRun.add(p.id)
          localCandidates.push(p)
        }
      } catch (e) {
        console.warn(`   text search failed for "${q}": ${(e as Error).message}`)
      }
    }
    console.log(`   ${localCandidates.length} new candidates`)

    // ── Trap pre-screen (cheap, runs on the search-stage place
    // which already has types[], name, address). Anything that
    // survives gets a Place Details fetch.
    for (const c of localCandidates) {
      if (costSoFar >= COST_CAP_USD) break
      examined++

      if (!SKIP_TRAP) {
        const trap = findRejectingTrap(c)
        if (trap) {
          rejected++
          rejectionTally[trap.id] = (rejectionTally[trap.id] ?? 0) + 1
          console.log(`   🚫 ${c.displayName?.text ?? '(unnamed)'} — ${trap.id}`)
          continue
        }
      }

      // ── Place Details: hours, reviews, editorial summary.
      let details: GPPlace
      try {
        details = await getPlaceDetails(c.id)
        costSoFar += COST.placeDetails
      } catch (e) {
        console.warn(`   details failed for ${c.displayName?.text}: ${(e as Error).message}`)
        continue
      }

      // ── Second-stage trap pre-screen: now we have businessStatus
      // (some places only mark CLOSED_PERMANENTLY in the details
      // response) and richer types[]. Cheap to re-run.
      if (!SKIP_TRAP) {
        const trap2 = findRejectingTrap(details)
        if (trap2) {
          rejected++
          rejectionTally[trap2.id] = (rejectionTally[trap2.id] ?? 0) + 1
          console.log(`   🚫 (details) ${details.displayName?.text} — ${trap2.id}`)
          continue
        }
      }

      // ── Convert + insert.
      const fakePriority: PriorityRow = {
        id: `flood-nyc-${target.neighborhood}`,
        city: 'New York City',
        neighborhood: target.neighborhood,
        priority_score: 0,
        last_scouted_at: null,
        lat: target.lat,
        lng: target.lng,
        radius_meters: target.radiusMeters,
      }
      const row = placeToScoutRow(details, fakePriority)

      if (DRY_RUN) {
        console.log(`   ✓ ${row.name}  (would insert)`)
        inserted++
        continue
      }

      const { error } = await db.from('spots').insert([
        { ...row, status: 'pending' },
      ])
      if (error) {
        // Most likely a race against another scout/flood run on
        // the same place_id; log and move on.
        console.warn(`   ⚠️  insert failed for ${row.name}: ${error.message}`)
        continue
      }
      console.log(`   ✓ ${row.name}`)
      inserted++
    }
  }

  // ── Summary
  console.log(`\n══ Done ══`)
  console.log(`   Cost:     $${costSoFar.toFixed(4)} of $${COST_CAP_USD.toFixed(2)} cap`)
  console.log(`   Examined: ${examined}`)
  console.log(`   Rejected: ${rejected} (trap pre-screen)`)
  console.log(`   Inserted: ${inserted}${DRY_RUN ? '  (would insert)' : '  as status=\'pending\''}`)
  if (Object.keys(rejectionTally).length > 0) {
    console.log(`\n   Rejection breakdown:`)
    for (const [id, n] of Object.entries(rejectionTally).sort((a, b) => b[1] - a[1])) {
      console.log(`     ${n.toString().padStart(3)}  ${id}`)
    }
  }
  if (!DRY_RUN && inserted > 0) {
    console.log(`\nNext steps:`)
    console.log(`   1. Run Curator to score the new rows (or wait for the daily 4:03 AM cron):`)
    console.log(`        npm run curate:workability`)
    console.log(`   2. Spot-check in /admin/spots and approve in bulk.`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
