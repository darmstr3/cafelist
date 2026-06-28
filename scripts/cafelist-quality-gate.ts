/**
 * CafeList — Publication Quality Gate
 *
 * Runs every approved spot through the QUALITY_BAR.md checklist and outputs
 * a per-spot verdict: publish | hold | review | reject.
 *
 * This is a READ-ONLY script. It never mutates the database.
 * It writes results to ops/reports/ and flags review items to ops/queues/.
 *
 * Checks performed:
 *   - Required fields present (name, address, city, lat/lng, type)
 *   - workability_score ≥ 6 for retriever eligibility (strict pass)
 *   - Outlet claims backed by enrichment (enriched_at + confidence ≥ 0.6)
 *   - Hours structured when hours claims made
 *   - Freshness (workability_scored_at ≤ 90d; last_verified_at ≤ 180d)
 *   - Coordinate validity (lat/lng in range, not (0,0))
 *   - Hours JSON parseable (open and close fields present)
 *   - Anomaly: score > 9 with no wifi evidence
 *   - Anomaly: workability_score > 6 with noise_level = 'loud'
 *   - SEO mode: ≥ 3 qualifying spots per neighborhood
 *
 * Usage:
 *   npx tsx scripts/cafelist-quality-gate.ts              # check all approved spots
 *   npx tsx scripts/cafelist-quality-gate.ts --seo        # also output SEO readiness per neighborhood
 *   npx tsx scripts/cafelist-quality-gate.ts --spot=<id>  # check a single spot
 *   npx tsx scripts/cafelist-quality-gate.ts --neighborhood="Fort Greene"
 *   npx tsx scripts/cafelist-quality-gate.ts --summary    # print summary only, not per-spot
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

// ── Flags ─────────────────────────────────────────────────────

const args = process.argv.slice(2)
const isSeoMode = args.includes('--seo')
const isSummaryOnly = args.includes('--summary')
const spotArg = args.find((a) => a.startsWith('--spot='))
const neighborhoodArg = args.find((a) => a.startsWith('--neighborhood='))
const SPOT_ID = spotArg ? spotArg.split('=')[1] : null
const NEIGHBORHOOD_FILTER = neighborhoodArg ? neighborhoodArg.split('=')[1] : null

// ── Thresholds (from QUALITY_BAR.md) ─────────────────────────

const WORKABILITY_STRICT_MIN = 6
const WORKABILITY_SCORED_STALENESS_DAYS = 90
const VERIFIED_STALENESS_DAYS = 180
const ENRICHED_STALENESS_DAYS = 90
const OUTLET_CONFIDENCE_MIN = 0.6
const SEO_MIN_QUALIFYING_SPOTS = 3

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
  console.error('[quality-gate] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── Types ─────────────────────────────────────────────────────

type Verdict = 'publish' | 'hold' | 'review' | 'reject'

interface Check {
  name: string
  passed: boolean
  message: string
  severity: 'blocking' | 'warning' | 'info'
}

interface SpotResult {
  id: string
  name: string
  neighborhood: string | null
  city: string
  verdict: Verdict
  checks: Check[]
  workability_score: number | null
  enriched_at: string | null
  last_verified_at: string | null
  workability_scored_at: string | null
}

// ── Helpers ───────────────────────────────────────────────────

function daysSince(isoDate: string | null): number | null {
  if (!isoDate) return null
  const ms = Date.now() - new Date(isoDate).getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

function isStale(isoDate: string | null, maxDays: number): boolean {
  const age = daysSince(isoDate)
  if (age === null) return true // null = never set = treat as stale
  return age > maxDays
}

function getEnrichmentConfidence(spot: Record<string, unknown>, field: string): number | null {
  const signals = spot.enrichment_signals as Record<string, { confidence?: number }> | null
  if (!signals) return null
  return signals[field]?.confidence ?? null
}

// ── Per-spot checks ───────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function runChecks(spot: Record<string, any>): Check[] {
  const checks: Check[] = []

  // 1. Required fields
  const missing: string[] = []
  if (!spot.name) missing.push('name')
  if (!spot.address) missing.push('address')
  if (!spot.city) missing.push('city')
  if (spot.lat == null) missing.push('lat')
  if (spot.lng == null) missing.push('lng')
  if (!spot.type) missing.push('type')

  checks.push({
    name: 'required_fields',
    passed: missing.length === 0,
    message: missing.length === 0
      ? 'All required fields present'
      : `Missing required fields: ${missing.join(', ')}`,
    severity: 'blocking',
  })

  // 2. Coordinate validity
  const lat = spot.lat as number | null
  const lng = spot.lng as number | null
  const coordsValid = lat !== null && lng !== null &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180 &&
    !(lat === 0 && lng === 0)

  checks.push({
    name: 'coordinate_validity',
    passed: coordsValid,
    message: coordsValid
      ? `Coordinates valid (${lat}, ${lng})`
      : `Invalid coordinates: (${lat}, ${lng})`,
    severity: 'blocking',
  })

  // 3. Workability score eligibility
  const score = spot.workability_score as number | null
  const meetsStrictThreshold = score !== null && score >= WORKABILITY_STRICT_MIN

  checks.push({
    name: 'workability_score_eligibility',
    passed: score !== null,
    message: score === null
      ? 'workability_score is null — not yet curated'
      : score >= WORKABILITY_STRICT_MIN
        ? `workability_score ${score} ≥ ${WORKABILITY_STRICT_MIN} (strict pass)`
        : `workability_score ${score} < ${WORKABILITY_STRICT_MIN} (below strict threshold)`,
    severity: score === null ? 'blocking' : (meetsStrictThreshold ? 'info' : 'warning'),
  })

  // 4. Workability score freshness
  const scoreStaleness = daysSince(spot.workability_scored_at)
  const scoreStale = isStale(spot.workability_scored_at, WORKABILITY_SCORED_STALENESS_DAYS)

  checks.push({
    name: 'workability_score_freshness',
    passed: !scoreStale,
    message: scoreStale
      ? scoreStaleness === null
        ? 'workability_score has never been set'
        : `workability_scored_at is ${scoreStaleness} days old (threshold: ${WORKABILITY_SCORED_STALENESS_DAYS}d)`
      : `workability_scored_at is ${scoreStaleness} days old — fresh`,
    severity: 'warning',
  })

  // 5. Verification freshness
  const verifiedStaleness = daysSince(spot.last_verified_at)
  const verifiedStale = isStale(spot.last_verified_at, VERIFIED_STALENESS_DAYS)

  checks.push({
    name: 'verification_freshness',
    passed: !verifiedStale,
    message: verifiedStale
      ? verifiedStaleness === null
        ? 'last_verified_at is null — never manually verified'
        : `last_verified_at is ${verifiedStaleness} days old (threshold: ${VERIFIED_STALENESS_DAYS}d)`
      : `last_verified_at is ${verifiedStaleness} days ago — verified`,
    severity: 'warning',
  })

  // 6. Enrichment freshness
  const enrichedStaleness = daysSince(spot.enriched_at)
  const enrichedStale = isStale(spot.enriched_at, ENRICHED_STALENESS_DAYS)

  checks.push({
    name: 'enrichment_freshness',
    passed: !enrichedStale,
    message: enrichedStale
      ? enrichedStaleness === null
        ? 'enriched_at is null — enricher has never run on this spot'
        : `enriched_at is ${enrichedStaleness} days old (threshold: ${ENRICHED_STALENESS_DAYS}d)`
      : `enriched_at is ${enrichedStaleness} days ago — fresh`,
    severity: 'warning',
  })

  // 7. Outlet claim validity
  if (spot.has_outlets === true) {
    const outletConfidence = getEnrichmentConfidence(spot, 'outlets')
    const hasEnrichment = spot.enriched_at != null
    const outletClaimValid = hasEnrichment && outletConfidence !== null && outletConfidence >= OUTLET_CONFIDENCE_MIN

    checks.push({
      name: 'outlet_claim_validity',
      passed: outletClaimValid,
      message: !hasEnrichment
        ? 'has_outlets=true but enriched_at is null — outlet claim cannot be made (likely Scout default)'
        : outletConfidence === null
          ? 'has_outlets=true but no outlet confidence in enrichment_signals'
          : outletConfidence < OUTLET_CONFIDENCE_MIN
            ? `has_outlets=true but outlet confidence ${outletConfidence.toFixed(2)} < ${OUTLET_CONFIDENCE_MIN} threshold`
            : `Outlet claim valid (confidence: ${outletConfidence.toFixed(2)})`,
      severity: 'warning',
    })
  }

  // 8. Hours validity
  const hours = spot.hours as Record<string, { open?: string; close?: string } | null> | null
  if (hours !== null) {
    const dayEntries = Object.values(hours).filter((d) => d !== null)
    const malformedDays = dayEntries.filter(
      (d) => d !== null && (d.open === undefined || d.close === undefined)
    )

    checks.push({
      name: 'hours_validity',
      passed: malformedDays.length === 0,
      message: malformedDays.length === 0
        ? `Hours valid (${dayEntries.length} days defined)`
        : `${malformedDays.length} hour entries missing open or close time`,
      severity: 'warning',
    })
  }

  // 9. Anomaly: suspiciously high score with no wifi evidence
  if (score !== null && score > 9 && !spot.has_wifi && spot.wifi_score < 5) {
    checks.push({
      name: 'anomaly_score_no_wifi',
      passed: false,
      message: `workability_score ${score} > 9 but has_wifi=false and wifi_score=${spot.wifi_score} — suspicious`,
      severity: 'warning',
    })
  }

  // 10. Anomaly: workability above threshold but explicitly loud
  if (score !== null && score >= WORKABILITY_STRICT_MIN && spot.noise_level === 'loud') {
    checks.push({
      name: 'anomaly_score_loud_venue',
      passed: false,
      message: `workability_score ${score} ≥ ${WORKABILITY_STRICT_MIN} but noise_level=loud — verify reasoning addresses noise`,
      severity: 'warning',
    })
  }

  return checks
}

function verdictFromChecks(checks: Check[]): Verdict {
  const hasBlockingFail = checks.some((c) => !c.passed && c.severity === 'blocking')
  if (hasBlockingFail) return 'reject'

  // Not scored = hold (not reject — it's a missing step, not a disqualifier)
  const scoreCheck = checks.find((c) => c.name === 'workability_score_eligibility')
  if (scoreCheck && !scoreCheck.passed && scoreCheck.message.includes('null')) return 'hold'

  // Any warning failures = review
  const hasWarningFail = checks.some((c) => !c.passed && c.severity === 'warning')
  if (hasWarningFail) return 'review'

  return 'publish'
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log('[quality-gate] Starting...')

  // Build query
  let query = supabase
    .from('spots')
    .select('id, name, slug, type, address, city, neighborhood, lat, lng, google_place_id, has_wifi, has_outlets, laptop_friendly, noise_level, wifi_score, outlet_score, hours, workability_score, workability_reasoning, workability_scored_at, last_verified_at, enriched_at, enrichment_signals, vibe_tags, status, created_at, updated_at')
    .eq('status', 'approved')

  if (SPOT_ID) {
    query = query.eq('id', SPOT_ID) as typeof query
  }
  if (NEIGHBORHOOD_FILTER) {
    query = query.eq('neighborhood', NEIGHBORHOOD_FILTER) as typeof query
  }

  const { data: spots, error } = await query

  if (error) {
    console.error('[quality-gate] Supabase error:', error.message)
    process.exit(1)
  }

  if (!spots || spots.length === 0) {
    console.log('[quality-gate] No approved spots found matching criteria.')
    process.exit(0)
  }

  console.log(`[quality-gate] Checking ${spots.length} approved spots...`)

  // Run checks
  const results: SpotResult[] = []
  const reviewItems: object[] = []

  for (const spot of spots) {
    const checks = runChecks(spot)
    const verdict = verdictFromChecks(checks)

    const result: SpotResult = {
      id: spot.id,
      name: spot.name,
      neighborhood: spot.neighborhood,
      city: spot.city,
      verdict,
      checks,
      workability_score: spot.workability_score,
      enriched_at: spot.enriched_at,
      last_verified_at: spot.last_verified_at,
      workability_scored_at: spot.workability_scored_at,
    }

    results.push(result)

    // Queue review items
    if (verdict === 'review') {
      const failedChecks = checks.filter((c) => !c.passed)
      reviewItems.push({
        id: spot.id,
        name: spot.name,
        why_flagged: failedChecks.map((c) => c.message).join('; '),
        evidence: {
          workability_score: spot.workability_score,
          has_outlets: spot.has_outlets,
          enriched_at: spot.enriched_at,
          last_verified_at: spot.last_verified_at,
          failed_checks: failedChecks.map((c) => c.name),
        },
        severity: failedChecks.some((c) => c.severity === 'blocking') ? 'high' : 'medium',
        recommended_action: 'Review failed checks and decide: enrich, verify, or update score',
        source_freshness: {
          enriched_at: spot.enriched_at,
          last_verified_at: spot.last_verified_at,
          workability_scored_at: spot.workability_scored_at,
        },
        flagged_at: new Date().toISOString(),
        flagged_by: 'cafelist:quality-gate',
        resolved_at: null,
        resolution: null,
        resolution_notes: null,
      })
    }
  }

  // ── Summary ─────────────────────────────────��──────────────

  const counts = {
    publish: results.filter((r) => r.verdict === 'publish').length,
    hold: results.filter((r) => r.verdict === 'hold').length,
    review: results.filter((r) => r.verdict === 'review').length,
    reject: results.filter((r) => r.verdict === 'reject').length,
  }

  console.log('\n[quality-gate] Summary:')
  console.log(`  Total checked:   ${results.length}`)
  console.log(`  ✅ Publish:       ${counts.publish}`)
  console.log(`  ⏸  Hold:         ${counts.hold}`)
  console.log(`  ⚠️  Review:       ${counts.review}`)
  console.log(`  ❌ Reject:        ${counts.reject}`)

  // ── Per-spot output ────────────────────────────────────────

  if (!isSummaryOnly) {
    console.log('\n[quality-gate] Spots requiring attention:')
    for (const r of results.filter((r) => r.verdict !== 'publish')) {
      const icon = r.verdict === 'hold' ? '⏸' : r.verdict === 'review' ? '⚠️' : '❌'
      console.log(`  ${icon} [${r.verdict.toUpperCase()}] ${r.name} (${r.neighborhood ?? r.city})`)
      for (const c of r.checks.filter((c) => !c.passed)) {
        console.log(`      → ${c.message}`)
      }
    }
  }

  // ── SEO neighborhood readiness ─────────────────────────────

  if (isSeoMode) {
    const neighborhoods = new Map<string, SpotResult[]>()
    for (const r of results) {
      const key = r.neighborhood ? `${r.city}::${r.neighborhood}` : `${r.city}::unknown`
      if (!neighborhoods.has(key)) neighborhoods.set(key, [])
      neighborhoods.get(key)!.push(r)
    }

    const seoState: Record<string, object> = {}
    console.log('\n[quality-gate] SEO Neighborhood Readiness:')

    for (const [key, spots] of neighborhoods.entries()) {
      const [city, hood] = key.split('::')
      const qualifying = spots.filter((s) => s.verdict === 'publish' && (s.workability_score ?? 0) >= WORKABILITY_STRICT_MIN)
      const status = qualifying.length >= SEO_MIN_QUALIFYING_SPOTS
        ? 'READY'
        : qualifying.length > 0
          ? 'ON_HOLD'
          : 'BLOCKED'

      const icon = status === 'READY' ? '✅' : status === 'ON_HOLD' ? '⏸' : '❌'
      const label = hood === 'unknown' ? `${city} (no neighborhood)` : `${hood}, ${city}`
      console.log(`  ${icon} [${status}] ${label}: ${qualifying.length}/${spots.length} qualifying spots`)

      seoState[key] = {
        city,
        neighborhood: hood === 'unknown' ? null : hood,
        status,
        qualifying_spots: qualifying.length,
        total_spots: spots.length,
        checked_at: new Date().toISOString(),
      }
    }

    // Write seo-state.json
    const seoStatePath = path.resolve(process.cwd(), 'ops/state/seo-state.json')
    let existing: Record<string, unknown> = { _description: 'SEO page readiness by neighborhood', neighborhoods: {} }
    try {
      existing = JSON.parse(fs.readFileSync(seoStatePath, 'utf-8'))
    } catch {
      // file missing or malformed — use default
    }
    existing._last_run = new Date().toISOString()
    existing.neighborhoods = seoState
    fs.writeFileSync(seoStatePath, JSON.stringify(existing, null, 2))
    console.log(`\n[quality-gate] SEO state written to ops/state/seo-state.json`)
  }

  // ── Write report ───────────────────────────────────────────

  const dateStr = new Date().toISOString().split('T')[0]
  const reportPath = path.resolve(process.cwd(), `ops/reports/quality-gate-${dateStr}.json`)
  const report = {
    generated_at: new Date().toISOString(),
    total_checked: results.length,
    summary: counts,
    verdicts: results.map((r) => ({
      id: r.id,
      name: r.name,
      neighborhood: r.neighborhood,
      city: r.city,
      verdict: r.verdict,
      workability_score: r.workability_score,
      failed_checks: r.checks.filter((c) => !c.passed).map((c) => ({ name: c.name, message: c.message, severity: c.severity })),
    })),
  }

  // Ensure ops/reports exists
  const reportsDir = path.resolve(process.cwd(), 'ops/reports')
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true })

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`\n[quality-gate] Report written to ${reportPath}`)

  // ── Update manual-review queue ─────────────────────────────

  if (reviewItems.length > 0) {
    const queuePath = path.resolve(process.cwd(), 'ops/queues/manual-review.json')
    let queue: { _description: string; _format: object; items: object[] }
    try {
      queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8'))
    } catch {
      queue = { _description: 'Manual review queue', _format: {}, items: [] }
    }

    // Append new items (avoid duplicates by ID)
    const existingIds = new Set(queue.items.map((i) => (i as { id: string }).id))
    const newItems = reviewItems.filter((i) => !existingIds.has((i as { id: string }).id))
    queue.items = [...queue.items, ...newItems]

    fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2))
    console.log(`[quality-gate] ${newItems.length} new items added to ops/queues/manual-review.json`)
  }

  // ── Data freshness state ───────────────────────────────────

  const freshnessPath = path.resolve(process.cwd(), 'ops/state/data-freshness.json')
  const freshnessData = {
    _description: 'Tracks data freshness state. Updated by cafelist:check-stale.',
    _last_run: new Date().toISOString(),
    _thresholds: {
      workability_scored_at_days: WORKABILITY_SCORED_STALENESS_DAYS,
      enriched_at_days: ENRICHED_STALENESS_DAYS,
      last_verified_at_days: VERIFIED_STALENESS_DAYS,
    },
    summary: {
      total_approved_spots: results.length,
      publish_eligible: counts.publish,
      needs_curation: results.filter((r) => r.checks.some((c) => c.name === 'workability_score_freshness' && !c.passed)).length,
      needs_verification: results.filter((r) => r.checks.some((c) => c.name === 'verification_freshness' && !c.passed)).length,
      needs_enrichment: results.filter((r) => r.checks.some((c) => c.name === 'enrichment_freshness' && !c.passed)).length,
      missing_required_fields: counts.reject,
      quality_gate_run_at: new Date().toISOString(),
    },
  }
  fs.writeFileSync(freshnessPath, JSON.stringify(freshnessData, null, 2))

  // Exit code: non-zero if any rejects or reviews (useful for CI)
  const exitCode = counts.reject > 0 ? 2 : counts.review > 0 ? 1 : 0
  if (exitCode > 0) {
    console.log(`\n[quality-gate] Exiting with code ${exitCode} (${counts.reject} rejects, ${counts.review} reviews)`)
  } else {
    console.log('\n[quality-gate] All approved spots pass quality checks. ✅')
  }
  process.exit(exitCode)
}

main().catch((err) => {
  console.error('[quality-gate] Fatal error:', err)
  process.exit(1)
})
