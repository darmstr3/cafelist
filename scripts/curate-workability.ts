/**
 * WorkSpot — Curator Agent (CLI wrapper)
 *
 * For every approved spot, asks Claude Haiku for a workability_score (0–10)
 * representing the answer to a single question:
 *
 *   "Can a remote worker realistically sit here for 2+ hours with a laptop
 *    without feeling pressured to leave?"
 *
 * This is deliberately distinct from `work_score`, which is NOT derived from
 * Cafelist's own on-platform reviews (the `reviews` table has ~2 rows total
 * — it's essentially unused). `work_score` is a heuristic computed by
 * scoreFromReviews() in lib/google-places.ts, which mines Google Places
 * review text for wifi/outlet/seating keyword hits and, when there's no
 * usable English review text, falls back to a rating-proxy derived from
 * Google's star rating. work_score = "what does the Google-review-keyword
 * heuristic say about the work setup?" — workability_score = "will the
 * *vibe* let you stay?"
 *
 * Why a separate score: review-based averages tend to over-rate restaurants
 * and bars (people rate the food/drinks 5/5 and the wifi 4/5, dragging the
 * work_score up), even though no one would actually camp there for 2 hours
 * during a dinner rush. The curator looks at type/vibe_tags/notes/hours
 * holistically and applies common sense.
 *
 * Note: work_score is also structurally missing (stuck at the raw column
 * default) for every scout-agent-submitted row, because nothing currently
 * backfills it after Scout inserts — see lib/spots.ts's isWorkScoreUnknown()
 * for how reads handle that. This script does not write work_score at all;
 * it only ever writes workability_score/_reasoning/_scored_at.
 *
 * Modes — same script, both modes:
 *   - Backfill:    re-score every row missing a score
 *   - Incremental: re-score new Scout rows + rows >90 days stale
 *
 * Idempotent: re-running picks up only unscored / stale rows.
 *
 * The actual scoring logic lives in src/lib/curator.ts's runCurator(),
 * shared with src/app/api/curate/route.ts — the HTTP entrypoint that
 * Vercel Cron now calls daily (see vercel.json). This file is a thin CLI
 * wrapper: parse flags, load env, call runCurator(), print, exit.
 *
 * Usage:
 *   npx tsx scripts/curate-workability.ts                  # full pass
 *   npx tsx scripts/curate-workability.ts --dry-run        # call LLM, don't write
 *   npx tsx scripts/curate-workability.ts --limit=20       # cap rows processed
 *   npx tsx scripts/curate-workability.ts --cost-cap=2.0   # USD ceiling (default 2)
 *   npx tsx scripts/curate-workability.ts --force          # re-score everyone, ignore staleness gate
 *   npx tsx scripts/curate-workability.ts --concurrency=4  # parallel API calls (default 4)
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { runCurator, DEFAULT_COST_CAP_USD } from '../src/lib/curator'

// ── Flags ─────────────────────────────────────────────────────

const args = process.argv.slice(2)
const isDryRun = args.includes('--dry-run')
const isForce = args.includes('--force')
const limitArg = args.find((a) => a.startsWith('--limit='))
const costCapArg = args.find((a) => a.startsWith('--cost-cap='))
const concurrencyArg = args.find((a) => a.startsWith('--concurrency='))
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Number.POSITIVE_INFINITY
const COST_CAP_USD = costCapArg ? parseFloat(costCapArg.split('=')[1]) : DEFAULT_COST_CAP_USD
const CONCURRENCY = concurrencyArg ? Math.max(1, parseInt(concurrencyArg.split('=')[1], 10)) : 4

// ── Env loading ───────────────────────────────────────────────
// Same pattern as scripts/import-nyc.ts — read .env.local manually so we
// don't pull in a dotenv dependency just for this script.

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
    // No .env.local — fall back to ambient env (CI, scheduled task, etc.).
  }
}

loadEnv()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[curator] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('[curator] Missing ANTHROPIC_API_KEY.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

function printDistribution(label: string, d: Awaited<ReturnType<typeof runCurator>>['before']) {
  console.log(`\n── Distribution: ${label} ─────────────────────`)
  console.log(`  approved rows: ${d.total}  scored: ${d.scored}  unscored: ${d.unscored}`)
  console.log(`  workability_score buckets:`)
  for (const k of ['0-2', '2-4', '4-6', '6-8', '8-10', 'unscored']) {
    const n = d.buckets[k] ?? 0
    const bar = '█'.repeat(Math.min(40, n))
    console.log(`    ${k.padEnd(8)} ${String(n).padStart(4)}  ${bar}`)
  }
  console.log(`  by type (viable = score ≥ 6):`)
  const types = Object.keys(d.byType).sort((a, b) => d.byType[b].total - d.byType[a].total)
  for (const t of types) {
    const v = d.byType[t]
    const pct = v.total > 0 ? Math.round((v.viable_ge_6 / v.total) * 100) : 0
    console.log(
      `    ${t.padEnd(14)} ${String(v.total).padStart(4)} total   ${String(v.viable_ge_6).padStart(4)} viable (${pct}%)   avg=${v.avg ?? '—'}`
    )
  }
}

async function main() {
  const result = await runCurator(supabase, {
    dryRun: isDryRun,
    force: isForce,
    limit: LIMIT,
    costCapUsd: COST_CAP_USD,
    concurrency: CONCURRENCY,
    logger: (m) => console.log(m),
  })

  printDistribution('BEFORE', result.before)
  printDistribution('AFTER', result.after)

  const viableBefore = (result.before.buckets['6-8'] ?? 0) + (result.before.buckets['8-10'] ?? 0)
  const viableAfter = (result.after.buckets['6-8'] ?? 0) + (result.after.buckets['8-10'] ?? 0)
  const totalScoredAfter = result.after.scored
  console.log(`\n── Curator summary ────────────────────────────`)
  console.log(`  processed:       ${result.processed}`)
  console.log(`  updated:         ${result.updated}${isDryRun ? ' (dry-run, no writes)' : ''}`)
  console.log(`  failed:          ${result.failed}`)
  console.log(
    `  cost (USD):      $${result.costUsd.toFixed(4)}  (cap $${result.costCapUsd.toFixed(2)}${result.costCapHit ? ' — HIT' : ''})`
  )
  console.log(`  viable (≥6):     before=${viableBefore}  after=${viableAfter}  (of ${totalScoredAfter} scored)`)
  if (totalScoredAfter > 0) {
    const viablePct = Math.round((viableAfter / totalScoredAfter) * 100)
    console.log(`  viable share:    ${viablePct}% (target: 40–60% drop from 100% review-only baseline)`)
  }

  if (result.status === 'already_running') {
    console.log('[curator] Another curator run is already in progress — this invocation did nothing. Not an error.')
    return
  }
  if (result.status === 'error') {
    console.error(`[curator] FATAL: ${result.error_message}`)
    process.exit(1)
  }
  if (result.failed > 0 && result.processed > 0 && result.failed / result.processed > 0.1) {
    console.error(`[curator] WARN: ${result.failed}/${result.processed} rows failed (>10%).`)
    process.exit(2)
  }
}

main().catch((e) => {
  console.error('[curator] FATAL:', e)
  process.exit(1)
})
