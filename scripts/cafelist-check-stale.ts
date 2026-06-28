/**
 * CafeList — Stale Data Detector
 *
 * Queries Supabase for spots that have stale or missing data and categorizes
 * them by what kind of work would refresh them.
 *
 * This is a READ-ONLY script. It never mutates the database.
 * It writes results to ops/queues/manual-review.json and updates
 * ops/state/data-freshness.json.
 *
 * Staleness thresholds (from QUALITY_BAR.md and DATA_SCHEMA.md):
 *   - workability_scored_at > 90 days (or null)  → needs_curation
 *   - enriched_at > 90 days (or null)             → needs_enrichment
 *   - last_verified_at > 180 days (or null)       → needs_verification
 *   - Required fields null                         → missing_fields
 *
 * Usage:
 *   npx tsx scripts/cafelist-check-stale.ts                  # check all approved spots
 *   npx tsx scripts/cafelist-check-stale.ts --status=pending # include pending spots too
 *   npx tsx scripts/cafelist-check-stale.ts --neighborhood="Fort Greene"
 *   npx tsx scripts/cafelist-check-stale.ts --summary        # print counts only
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

// ── Flags ─────────────────────────────────────────────────────

const args = process.argv.slice(2)
const isSummaryOnly = args.includes('--summary')
const statusArg = args.find((a) => a.startsWith('--status='))
const neighborhoodArg = args.find((a) => a.startsWith('--neighborhood='))
const STATUS_FILTER = statusArg ? statusArg.split('=')[1] : 'approved'
const NEIGHBORHOOD_FILTER = neighborhoodArg ? neighborhoodArg.split('=')[1] : null

// ── Thresholds ─────────────────────────────────────────────────

const WORKABILITY_STALENESS_DAYS = 90
const ENRICHMENT_STALENESS_DAYS = 90
const VERIFICATION_STALENESS_DAYS = 180

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
  console.error('[check-stale] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── Types ─────────────────────────────────────────────────────

type StalenessCategory = 'needs_enrichment' | 'needs_curation' | 'needs_verification' | 'missing_fields' | 'fresh'

interface StaleRecord {
  id: string
  name: string
  city: string
  neighborhood: string | null
  status: string
  categories: StalenessCategory[]
  enriched_at: string | null
  workability_scored_at: string | null
  last_verified_at: string | null
  workability_score: number | null
  enriched_age_days: number | null
  scored_age_days: number | null
  verified_age_days: number | null
  missing_fields: string[]
}

// ── Helpers ───────────────────────────────────────────────────

function daysSince(isoDate: string | null): number | null {
  if (!isoDate) return null
  const ms = Date.now() - new Date(isoDate).getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

function isStale(isoDate: string | null, maxDays: number): boolean {
  const age = daysSince(isoDate)
  return age === null || age > maxDays
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log('[check-stale] Starting...')

  // Build query
  let query = supabase
    .from('spots')
    .select('id, name, slug, type, address, city, neighborhood, lat, lng, has_wifi, has_outlets, noise_level, workability_score, workability_scored_at, last_verified_at, enriched_at, status, created_at')
    .eq('status', STATUS_FILTER)

  if (NEIGHBORHOOD_FILTER) {
    query = query.eq('neighborhood', NEIGHBORHOOD_FILTER) as typeof query
  }

  const { data: spots, error } = await query

  if (error) {
    console.error('[check-stale] Supabase error:', error.message)
    process.exit(1)
  }

  if (!spots || spots.length === 0) {
    console.log(`[check-stale] No spots found with status=${STATUS_FILTER}.`)
    process.exit(0)
  }

  console.log(`[check-stale] Checking ${spots.length} spots...`)

  // Categorize spots
  const records: StaleRecord[] = []
  const reviewItems: object[] = []

  for (const spot of spots) {
    const categories: StalenessCategory[] = []
    const missing: string[] = []

    // Missing required fields
    if (!spot.address) missing.push('address')
    if (spot.lat == null) missing.push('lat')
    if (spot.lng == null) missing.push('lng')
    if (spot.neighborhood == null) missing.push('neighborhood')
    if (missing.length > 0) categories.push('missing_fields')

    // Needs enrichment
    if (isStale(spot.enriched_at, ENRICHMENT_STALENESS_DAYS)) {
      categories.push('needs_enrichment')
    }

    // Needs curation (workability scoring)
    if (isStale(spot.workability_scored_at, WORKABILITY_STALENESS_DAYS)) {
      categories.push('needs_curation')
    }

    // Needs verification
    if (isStale(spot.last_verified_at, VERIFICATION_STALENESS_DAYS)) {
      categories.push('needs_verification')
    }

    if (categories.length === 0) {
      categories.push('fresh')
    }

    const record: StaleRecord = {
      id: spot.id,
      name: spot.name,
      city: spot.city,
      neighborhood: spot.neighborhood,
      status: spot.status,
      categories,
      enriched_at: spot.enriched_at,
      workability_scored_at: spot.workability_scored_at,
      last_verified_at: spot.last_verified_at,
      workability_score: spot.workability_score,
      enriched_age_days: daysSince(spot.enriched_at),
      scored_age_days: daysSince(spot.workability_scored_at),
      verified_age_days: daysSince(spot.last_verified_at),
      missing_fields: missing,
    }

    records.push(record)

    // Add high-priority items to review queue (missing fields or never enriched)
    if (categories.includes('missing_fields') || (spot.enriched_at === null && spot.status === 'approved')) {
      reviewItems.push({
        id: spot.id,
        name: spot.name,
        why_flagged: categories.includes('missing_fields')
          ? `Missing required fields: ${missing.join(', ')}`
          : 'Approved spot never enriched — outlet claims unreliable',
        evidence: {
          categories,
          missing_fields: missing,
          enriched_at: spot.enriched_at,
          workability_scored_at: spot.workability_scored_at,
          last_verified_at: spot.last_verified_at,
        },
        severity: categories.includes('missing_fields') ? 'high' : 'medium',
        recommended_action: categories.includes('missing_fields')
          ? `Fix missing fields in Supabase: ${missing.join(', ')}`
          : 'Run npm run enrich to populate enrichment signals',
        source_freshness: {
          enriched_at: spot.enriched_at,
          last_verified_at: spot.last_verified_at,
          workability_scored_at: spot.workability_scored_at,
        },
        flagged_at: new Date().toISOString(),
        flagged_by: 'cafelist:check-stale',
        resolved_at: null,
        resolution: null,
        resolution_notes: null,
      })
    }
  }

  // ── Summary ────────────────────────────────────────────────

  const counts = {
    total: records.length,
    fresh: records.filter((r) => r.categories.includes('fresh')).length,
    needs_enrichment: records.filter((r) => r.categories.includes('needs_enrichment')).length,
    needs_curation: records.filter((r) => r.categories.includes('needs_curation')).length,
    needs_verification: records.filter((r) => r.categories.includes('needs_verification')).length,
    missing_fields: records.filter((r) => r.categories.includes('missing_fields')).length,
  }

  console.log('\n[check-stale] Summary:')
  console.log(`  Total spots:          ${counts.total}`)
  console.log(`  ✅ Fully fresh:        ${counts.fresh}`)
  console.log(`  🔍 Needs enrichment:  ${counts.needs_enrichment}  (run: npm run enrich)`)
  console.log(`  📊 Needs curation:    ${counts.needs_curation}  (run: npm run curate:workability)`)
  console.log(`  ✋ Needs verification: ${counts.needs_verification}  (human review required)`)
  console.log(`  ❌ Missing fields:     ${counts.missing_fields}  (fix in Supabase)`)

  // ── Per-spot output ────────────────────────────────────────

  if (!isSummaryOnly) {
    if (counts.missing_fields > 0) {
      console.log('\n[check-stale] Spots with missing required fields:')
      for (const r of records.filter((r) => r.categories.includes('missing_fields'))) {
        console.log(`  ❌ ${r.name} (${r.neighborhood ?? r.city}): missing ${r.missing_fields.join(', ')}`)
      }
    }

    if (counts.needs_enrichment > 0) {
      console.log('\n[check-stale] Top spots needing enrichment (by age):')
      const toEnrich = records
        .filter((r) => r.categories.includes('needs_enrichment'))
        .sort((a, b) => (b.enriched_age_days ?? 999999) - (a.enriched_age_days ?? 999999))
        .slice(0, 10)
      for (const r of toEnrich) {
        const age = r.enriched_age_days === null ? 'never' : `${r.enriched_age_days}d ago`
        console.log(`  🔍 ${r.name} (${r.neighborhood ?? r.city}): enriched ${age}`)
      }
      if (counts.needs_enrichment > 10) {
        console.log(`  ... and ${counts.needs_enrichment - 10} more`)
      }
    }
  }

  // ── Write full report ──────────────────────────────────────

  const dateStr = new Date().toISOString().split('T')[0]
  const reportPath = path.resolve(process.cwd(), `ops/reports/stale-check-${dateStr}.json`)
  const reportsDir = path.resolve(process.cwd(), 'ops/reports')
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true })

  const report = {
    generated_at: new Date().toISOString(),
    status_filter: STATUS_FILTER,
    neighborhood_filter: NEIGHBORHOOD_FILTER,
    thresholds: {
      workability_scored_at_days: WORKABILITY_STALENESS_DAYS,
      enriched_at_days: ENRICHMENT_STALENESS_DAYS,
      last_verified_at_days: VERIFICATION_STALENESS_DAYS,
    },
    summary: counts,
    stale_records: records
      .filter((r) => !r.categories.includes('fresh'))
      .sort((a, b) => b.categories.length - a.categories.length)
      .map((r) => ({
        id: r.id,
        name: r.name,
        city: r.city,
        neighborhood: r.neighborhood,
        categories: r.categories,
        enriched_age_days: r.enriched_age_days,
        scored_age_days: r.scored_age_days,
        verified_age_days: r.verified_age_days,
        workability_score: r.workability_score,
        missing_fields: r.missing_fields,
      })),
  }

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`\n[check-stale] Report written to ${reportPath}`)

  // ── Update manual-review queue ─────────────────────────────

  if (reviewItems.length > 0) {
    const queuePath = path.resolve(process.cwd(), 'ops/queues/manual-review.json')
    let queue: { _description: string; _format: object; items: object[] }
    try {
      queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8'))
    } catch {
      queue = { _description: 'Manual review queue', _format: {}, items: [] }
    }

    const existingIds = new Set(queue.items.map((i) => (i as { id: string }).id))
    const newItems = reviewItems.filter((i) => !existingIds.has((i as { id: string }).id))
    queue.items = [...queue.items, ...newItems]
    fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2))
    console.log(`[check-stale] ${newItems.length} new items added to ops/queues/manual-review.json`)
  }

  // ── Update data-freshness state ────────────────────────────

  const freshnessPath = path.resolve(process.cwd(), 'ops/state/data-freshness.json')
  const freshnessData = {
    _description: 'Tracks data freshness state for the CafeList spot database. Updated by cafelist:check-stale script.',
    _last_run: new Date().toISOString(),
    _thresholds: {
      workability_scored_at_days: WORKABILITY_STALENESS_DAYS,
      enriched_at_days: ENRICHMENT_STALENESS_DAYS,
      last_verified_at_days: VERIFICATION_STALENESS_DAYS,
    },
    summary: {
      total_approved_spots: counts.total,
      needs_enrichment: counts.needs_enrichment,
      needs_curation: counts.needs_curation,
      needs_verification: counts.needs_verification,
      missing_required_fields: counts.missing_fields,
      fully_fresh: counts.fresh,
    },
    note: `Last updated ${new Date().toISOString()} by cafelist:check-stale`,
  }
  fs.writeFileSync(freshnessPath, JSON.stringify(freshnessData, null, 2))

  // ── Suggested next actions ─────────────────────────────────

  console.log('\n[check-stale] Suggested next steps:')
  if (counts.needs_enrichment > 0) {
    console.log(`  1. Run: npm run enrich       (will process ~${counts.needs_enrichment} spots)`)
  }
  if (counts.needs_curation > 0) {
    console.log(`  2. Run: npm run curate:workability  (will re-score ~${counts.needs_curation} spots)`)
  }
  if (counts.missing_fields > 0) {
    console.log(`  3. Fix ${counts.missing_fields} spots with missing fields in Supabase (see report)`)
  }

  // Exit code: non-zero if stale spots exist
  const exitCode = (counts.needs_enrichment + counts.missing_fields + counts.needs_curation) > 0 ? 1 : 0
  process.exit(exitCode)
}

main().catch((err) => {
  console.error('[check-stale] Fatal error:', err)
  process.exit(1)
})
