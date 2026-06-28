/**
 * CafeList — Duplicate Finder
 *
 * Scans all spots in Supabase for likely duplicates using three strategies:
 *
 *   1. Exact google_place_id match (definite duplicate)
 *   2. Normalized name + same city (likely duplicate)
 *   3. Coordinate proximity (< ~50m) + similar name (possible duplicate)
 *
 * This is a READ-ONLY script. It never merges, deletes, or modifies records.
 * HUMAN APPROVAL IS REQUIRED before any merge or deletion.
 * Chain locations in the same city are NOT duplicates even if names match.
 *
 * It writes candidate groups to ops/queues/duplicate-candidates.json.
 *
 * Usage:
 *   npx tsx scripts/cafelist-find-duplicates.ts                    # all spots
 *   npx tsx scripts/cafelist-find-duplicates.ts --status=approved  # approved only
 *   npx tsx scripts/cafelist-find-duplicates.ts --city="New York"
 *   npx tsx scripts/cafelist-find-duplicates.ts --threshold=0.0003 # ~30m proximity
 *   npx tsx scripts/cafelist-find-duplicates.ts --summary          # counts only
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

// ── Flags ─────────────────────────────────────────────────────

const args = process.argv.slice(2)
const isSummaryOnly = args.includes('--summary')
const statusArg = args.find((a) => a.startsWith('--status='))
const cityArg = args.find((a) => a.startsWith('--city='))
const thresholdArg = args.find((a) => a.startsWith('--threshold='))

const STATUS_FILTER = statusArg ? statusArg.split('=')[1] : null // null = all statuses
const CITY_FILTER = cityArg ? cityArg.split('=')[1] : null
// ~0.0005 degrees ≈ 55m at mid-latitudes (latitude: 1 deg ≈ 111km)
const COORD_THRESHOLD = thresholdArg ? parseFloat(thresholdArg.split('=')[1]) : 0.0005

// ── Env loading ───────────────────────────────────────────────

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
    // fall back to ambient env
  }
}

loadEnv()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[find-duplicates] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── Types ─────────────────────────────────────────────────────

type DuplicateConfidence = 'definite' | 'likely' | 'possible'

interface SpotSummary {
  id: string
  name: string
  address: string
  city: string
  neighborhood: string | null
  lat: number | null
  lng: number | null
  google_place_id: string | null
  status: string
  workability_score: number | null
  created_at: string
}

interface DuplicateGroup {
  group_id: string
  confidence: DuplicateConfidence
  match_reason: string
  spots: SpotSummary[]
  flagged_at: string
  resolved_at: null
  resolution: null
  resolution_notes: null
}

// ── Helpers ───────────────────────────────────────────────────

/** Strip common prefixes/suffixes and normalize for comparison */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^the\s+/i, '')
    .replace(/\s+(cafe|coffee|coffeehouse|coffee house|espresso|roasters?|bar|restaurant|bakery|patisserie)$/i, '')
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

/** Euclidean distance in degrees (good enough for duplicate detection at city scale) */
function coordDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return Math.sqrt(Math.pow(lat1 - lat2, 2) + Math.pow(lng1 - lng2, 2))
}

/** Simple name similarity: fraction of chars in common (Jaccard on bigrams) */
function nameSimilarity(a: string, b: string): number {
  if (a === b) return 1.0
  const bigrams = (s: string) => new Set(Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2)))
  const ba = bigrams(a)
  const bb = bigrams(b)
  const intersection = [...ba].filter((x) => bb.has(x)).length
  const union = new Set([...ba, ...bb]).size
  return union === 0 ? 0 : intersection / union
}

function groupId(): string {
  return `dup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log('[find-duplicates] Starting...')

  // Build query
  let query = supabase
    .from('spots')
    .select('id, name, slug, address, city, neighborhood, lat, lng, google_place_id, status, workability_score, created_at')
    .order('city', { ascending: true })
    .order('name', { ascending: true })

  if (STATUS_FILTER) {
    query = query.eq('status', STATUS_FILTER) as typeof query
  }
  if (CITY_FILTER) {
    query = query.eq('city', CITY_FILTER) as typeof query
  }

  const { data: spots, error } = await query

  if (error) {
    console.error('[find-duplicates] Supabase error:', error.message)
    process.exit(1)
  }

  if (!spots || spots.length === 0) {
    console.log('[find-duplicates] No spots found matching criteria.')
    process.exit(0)
  }

  console.log(`[find-duplicates] Checking ${spots.length} spots for duplicates...`)

  const groups: DuplicateGroup[] = []
  const seenIds = new Set<string>()

  // ── Pass 1: Exact google_place_id match ────────────────────

  const byPlaceId = new Map<string, SpotSummary[]>()
  for (const spot of spots) {
    if (!spot.google_place_id) continue
    const key = spot.google_place_id
    if (!byPlaceId.has(key)) byPlaceId.set(key, [])
    byPlaceId.get(key)!.push(spot as SpotSummary)
  }

  for (const [placeId, group] of byPlaceId.entries()) {
    if (group.length < 2) continue
    // These are definite duplicates
    for (const s of group) seenIds.add(s.id)
    groups.push({
      group_id: groupId(),
      confidence: 'definite',
      match_reason: `Identical google_place_id: ${placeId}`,
      spots: group,
      flagged_at: new Date().toISOString(),
      resolved_at: null,
      resolution: null,
      resolution_notes: null,
    })
  }

  // ── Pass 2: Normalized name + same city ────────────────────

  const byCity = new Map<string, SpotSummary[]>()
  for (const spot of spots) {
    if (!byCity.has(spot.city)) byCity.set(spot.city, [])
    byCity.get(spot.city)!.push(spot as SpotSummary)
  }

  for (const [city, citySpots] of byCity.entries()) {
    // Group by normalized name
    const byNormalizedName = new Map<string, SpotSummary[]>()
    for (const spot of citySpots) {
      const key = normalizeName(spot.name)
      if (!key) continue
      if (!byNormalizedName.has(key)) byNormalizedName.set(key, [])
      byNormalizedName.get(key)!.push(spot)
    }

    for (const [normName, group] of byNormalizedName.entries()) {
      if (group.length < 2) continue
      // Skip if already caught by place ID pass
      if (group.every((s) => seenIds.has(s.id))) continue

      for (const s of group) seenIds.add(s.id)
      groups.push({
        group_id: groupId(),
        confidence: 'likely',
        match_reason: `Normalized name "${normName}" matches ${group.length} spots in ${city}`,
        spots: group,
        flagged_at: new Date().toISOString(),
        resolved_at: null,
        resolution: null,
        resolution_notes: null,
      })
    }
  }

  // ── Pass 3: Coordinate proximity ──────────────────────────

  const spotsWithCoords = spots.filter(
    (s) => s.lat != null && s.lng != null
  ) as (SpotSummary & { lat: number; lng: number })[]

  // Group by city first to limit comparison scope
  const coordsByCityMap = new Map<string, typeof spotsWithCoords>()
  for (const spot of spotsWithCoords) {
    if (!coordsByCityMap.has(spot.city)) coordsByCityMap.set(spot.city, [])
    coordsByCityMap.get(spot.city)!.push(spot)
  }

  for (const [, citySpots] of coordsByCityMap.entries()) {
    const n = citySpots.length
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = citySpots[i]
        const b = citySpots[j]

        // Skip if already grouped
        if (seenIds.has(a.id) && seenIds.has(b.id)) continue

        const dist = coordDistance(a.lat, a.lng, b.lat, b.lng)
        if (dist > COORD_THRESHOLD) continue

        // Check name similarity
        const sim = nameSimilarity(normalizeName(a.name), normalizeName(b.name))
        if (sim < 0.4) continue // Very different names at same location = probably not the same spot

        seenIds.add(a.id)
        seenIds.add(b.id)

        const distMeters = Math.round(dist * 111000) // approx meters
        groups.push({
          group_id: groupId(),
          confidence: sim >= 0.7 ? 'likely' : 'possible',
          match_reason: `Coordinates within ${distMeters}m, name similarity ${(sim * 100).toFixed(0)}% ("${a.name}" / "${b.name}")`,
          spots: [a, b],
          flagged_at: new Date().toISOString(),
          resolved_at: null,
          resolution: null,
          resolution_notes: null,
        })
      }
    }
  }

  // ── Summary ────────────────────────────────────────────────

  const counts = {
    total_groups: groups.length,
    definite: groups.filter((g) => g.confidence === 'definite').length,
    likely: groups.filter((g) => g.confidence === 'likely').length,
    possible: groups.filter((g) => g.confidence === 'possible').length,
    total_flagged_spots: new Set(groups.flatMap((g) => g.spots.map((s) => s.id))).size,
  }

  console.log('\n[find-duplicates] Summary:')
  console.log(`  Total spots checked:  ${spots.length}`)
  console.log(`  Duplicate groups:     ${counts.total_groups}`)
  console.log(`  🔴 Definite:          ${counts.definite}  (identical google_place_id)`)
  console.log(`  🟡 Likely:            ${counts.likely}  (same normalized name in city)`)
  console.log(`  🟢 Possible:          ${counts.possible}  (close coordinates + similar name)`)
  console.log(`  Total flagged spots:  ${counts.total_flagged_spots}`)

  if (!isSummaryOnly && groups.length > 0) {
    console.log('\n[find-duplicates] Duplicate groups (human review required before any merge):')
    for (const g of groups) {
      const icon = g.confidence === 'definite' ? '🔴' : g.confidence === 'likely' ? '🟡' : '🟢'
      console.log(`\n  ${icon} [${g.confidence.toUpperCase()}] ${g.match_reason}`)
      for (const s of g.spots) {
        console.log(`    - ${s.name} (${s.status}) | ${s.address} | score: ${s.workability_score ?? 'unscored'} | id: ${s.id}`)
      }
    }
  }

  // ── Write to ops/queues/duplicate-candidates.json ─────────

  const queuePath = path.resolve(process.cwd(), 'ops/queues/duplicate-candidates.json')
  let existingQueue: { _description: string; _format: object; groups: DuplicateGroup[] }
  try {
    existingQueue = JSON.parse(fs.readFileSync(queuePath, 'utf-8'))
  } catch {
    existingQueue = { _description: 'Duplicate candidate groups', _format: {}, groups: [] }
  }

  // Don't add groups that are already in the queue and unresolved
  const existingUnresolved = new Set<string>()
  for (const g of existingQueue.groups) {
    if (!g.resolved_at) {
      for (const s of g.spots) {
        existingUnresolved.add(s.id)
      }
    }
  }

  const newGroups = groups.filter(
    (g) => !g.spots.every((s) => existingUnresolved.has(s.id))
  )

  existingQueue.groups = [...existingQueue.groups, ...newGroups]
  fs.writeFileSync(queuePath, JSON.stringify(existingQueue, null, 2))

  console.log(`\n[find-duplicates] ${newGroups.length} new duplicate groups written to ops/queues/duplicate-candidates.json`)
  console.log('[find-duplicates] ⚠️  HUMAN REVIEW REQUIRED before any merge. No automatic merges.')

  if (groups.length > 0) {
    console.log('\n[find-duplicates] To resolve: open ops/queues/duplicate-candidates.json,')
    console.log('  set resolved_at and resolution ("merged"|"not_duplicate"|"deferred") for each group.')
    console.log('  Then perform any merges manually in Supabase.')
  }

  // Write date-stamped report
  const dateStr = new Date().toISOString().split('T')[0]
  const reportPath = path.resolve(process.cwd(), `ops/reports/duplicates-${dateStr}.json`)
  const reportsDir = path.resolve(process.cwd(), 'ops/reports')
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify({ generated_at: new Date().toISOString(), summary: counts, groups }, null, 2))
  console.log(`[find-duplicates] Full report written to ${reportPath}`)

  // Exit code: non-zero if definite duplicates found
  process.exit(counts.definite > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('[find-duplicates] Fatal error:', err)
  process.exit(1)
})
