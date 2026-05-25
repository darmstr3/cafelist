/**
 * WorkSpot — Curator Agent
 *
 * For every approved spot, asks Claude Haiku for a workability_score (0–10)
 * representing the answer to a single question:
 *
 *   "Can a remote worker realistically sit here for 2+ hours with a laptop
 *    without feeling pressured to leave?"
 *
 * This is deliberately distinct from `work_score`, which is a review-derived
 * average of wifi/outlets/seating ratings. work_score = "is the work setup
 * good?" — workability_score = "will the *vibe* let you stay?"
 *
 * Why a separate score: review-based averages tend to over-rate restaurants
 * and bars (people rate the food/drinks 5/5 and the wifi 4/5, dragging the
 * work_score up), even though no one would actually camp there for 2 hours
 * during a dinner rush. The curator looks at type/vibe_tags/notes/hours
 * holistically and applies common sense.
 *
 * Modes — same script, both modes:
 *   - Backfill:    re-score every row missing a score
 *   - Incremental: re-score new Scout rows + rows >90 days stale
 *
 * Idempotent: re-running picks up only unscored / stale rows, so the daily
 * scheduled task can call this without coordination.
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
import { callClaudeJson, DEFAULT_MODEL } from '../src/lib/labs/anthropic'
import type { Spot } from '../src/types'

// ── Flags ─────────────────────────────────────────────────────

const args = process.argv.slice(2)
const isDryRun = args.includes('--dry-run')
const isForce = args.includes('--force')
const limitArg = args.find((a) => a.startsWith('--limit='))
const costCapArg = args.find((a) => a.startsWith('--cost-cap='))
const concurrencyArg = args.find((a) => a.startsWith('--concurrency='))
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Number.POSITIVE_INFINITY
const COST_CAP_USD = costCapArg ? parseFloat(costCapArg.split('=')[1]) : 2.0
const CONCURRENCY = concurrencyArg ? Math.max(1, parseInt(concurrencyArg.split('=')[1], 10)) : 4

// Rows older than this are considered stale and re-scored. 90 days
// matches the project spec — venues open/close/change hours and the
// score should drift with reality, not be a one-time stamp.
const STALENESS_DAYS = 90

// Page size for the unscored-rows query. Small enough that any single
// page reload doesn't waste much work if the script is interrupted.
const PAGE_SIZE = 50

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

// ── Prompt ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Cafelist Curator. Your job is to score a single venue on one specific question, and one only:

  "Can a remote worker realistically sit here for 2+ hours with a laptop without feeling pressured to leave?"

Score is a single number from 0 to 10 (one decimal allowed):
  10 = a coworking-style space or library; clearly designed for long work sessions
   8 = a coffee shop with ample seating, outlets, and a culture of camping
   6 = workable but with friction (limited seating, noisier, table-turn pressure during peaks)
   4 = it's technically possible but you'd feel awkward (e.g. small cafe, busy diner, hotel lobby with stiff seating)
   2 = a bar/restaurant where staff would notice and care; sitting 2 hours feels rude
   0 = no laptops welcome / no seating / drive-through / extremely cramped

CRITICAL HEURISTICS:
- A high work_score (review average) does NOT mean high workability. A diner can score 8 on wifi/outlets/seating in reviews and still be a place where camping for 2 hrs is socially weird. Trust venue type and vibe_tags MORE than the existing scores.
- Type matters a lot:
    * library / coworking → start at 9
    * coffee_shop → start at 6, adjust ±2 based on signals
    * hotel_lobby → start at 5; nicer hotels with lounge seating go up, stiff lobbies go down
    * diner → start at 4 (unless 24hr / clearly camping-friendly)
    * bar → start at 2 (unless explicitly marked as a daytime work spot)
    * other → start at 4
- vibe_tags like "cozy", "spacious", "quiet", "24hr", "work-friendly", "communal table" → push UP
- vibe_tags like "trendy", "cocktail bar", "date spot", "speakeasy", "intimate", "small" → push DOWN
- laptop_friendly=false → cap at 4
- noise_level "loud" → cap at 5
- seating_comfort "poor" → cap at 5
- Short open hours (closes before 6pm) → small penalty, you'd be rushed
- has_outlets=false AND has_wifi=false → cap at 3
- notes that explicitly say "no laptops" or "limited seating during peak" → push DOWN hard

Return ONLY a JSON object with this exact shape, no prose, no markdown:
{
  "score": <number 0-10, one decimal max>,
  "reasoning": "<one sentence, max 30 words, explaining the score>"
}`

interface CuratorOutput {
  score: number
  reasoning: string
}

// ── Helpers ───────────────────────────────────────────────────

/** Compact signal payload sent to Claude. Avoid sending huge fields
 * like photos[] or raw IDs — the model only needs decision-relevant signals. */
function spotToSignals(spot: Spot) {
  return {
    name: spot.name,
    type: spot.type,
    address: spot.address,
    city: spot.city,
    neighborhood: spot.neighborhood,
    hours: spot.hours,
    has_wifi: spot.has_wifi,
    has_outlets: spot.has_outlets,
    laptop_friendly: spot.laptop_friendly,
    noise_level: spot.noise_level,
    seating_comfort: spot.seating_comfort,
    vibe_tags: spot.vibe_tags ?? [],
    notes: spot.notes,
    existing_work_score: spot.work_score, // included as a prior, not authoritative
  }
}

function clampScore(n: unknown): number | null {
  const x = typeof n === 'number' ? n : parseFloat(String(n))
  if (!Number.isFinite(x)) return null
  return Math.round(Math.max(0, Math.min(10, x)) * 10) / 10
}

/** Score one spot. Returns null on unrecoverable error so we can skip
 * and continue rather than crashing the whole run. */
async function scoreSpot(spot: Spot): Promise<
  | { ok: true; score: number; reasoning: string; costUsd: number }
  | { ok: false; reason: string; costUsd: number }
> {
  const signals = spotToSignals(spot)
  const userMsg = `Score this venue:\n\n${JSON.stringify(signals, null, 2)}`

  try {
    const { data, usage } = await callClaudeJson<CuratorOutput>({
      system: SYSTEM_PROMPT,
      user: userMsg,
      // Bumped 200 → 500 (2026-05-25). Was truncating Haiku mid-JSON when
      // reasoning ran long, causing ~29% failure rate that tripped the
      // >10% guard and made the script exit before draining the backlog.
      // 500 is still tight but leaves slack for verbose reasoning.
      maxTokens: 500,
    })
    const score = clampScore(data.score)
    if (score === null) {
      return { ok: false, reason: `non-numeric score: ${JSON.stringify(data)}`, costUsd: usage.estimatedCostUsd }
    }
    const reasoning = (data.reasoning ?? '').toString().trim().slice(0, 500) || '(no reasoning)'
    return { ok: true, score, reasoning, costUsd: usage.estimatedCostUsd }
  } catch (e) {
    return { ok: false, reason: (e as Error).message, costUsd: 0 }
  }
}

// ── Distribution print ────────────────────────────────────────

interface Distribution {
  total: number
  scored: number
  unscored: number
  buckets: Record<string, number> // "0-2", "2-4", ... "8-10", "unscored"
  byType: Record<string, { total: number; viable_ge_6: number; avg: number | null }>
}

async function snapshotDistribution(label: string): Promise<Distribution> {
  const { data, error } = await supabase
    .from('spots')
    .select('type, workability_score')
    .eq('status', 'approved')

  if (error) {
    console.error(`[curator] Failed to read ${label} distribution:`, error.message)
    return { total: 0, scored: 0, unscored: 0, buckets: {}, byType: {} }
  }

  const rows = (data ?? []) as Array<{ type: string; workability_score: number | null }>
  const dist: Distribution = {
    total: rows.length,
    scored: 0,
    unscored: 0,
    buckets: { '0-2': 0, '2-4': 0, '4-6': 0, '6-8': 0, '8-10': 0, unscored: 0 },
    byType: {},
  }

  for (const r of rows) {
    const t = dist.byType[r.type] ?? { total: 0, viable_ge_6: 0, avg: null as number | null }
    t.total++
    if (r.workability_score === null || r.workability_score === undefined) {
      dist.unscored++
      dist.buckets.unscored++
    } else {
      dist.scored++
      const s = r.workability_score
      if (s < 2) dist.buckets['0-2']++
      else if (s < 4) dist.buckets['2-4']++
      else if (s < 6) dist.buckets['4-6']++
      else if (s < 8) dist.buckets['6-8']++
      else dist.buckets['8-10']++
      if (s >= 6) t.viable_ge_6++
      // running average; initialised lazily below
      const prevAvg = t.avg ?? 0
      const newCount = t.total - 0 // simple running mean by re-derivation below
      t.avg = prevAvg + (s - prevAvg) / newCount
    }
    dist.byType[r.type] = t
  }

  // Round avg for display.
  for (const k of Object.keys(dist.byType)) {
    const v = dist.byType[k]
    v.avg = v.avg === null ? null : Math.round(v.avg * 100) / 100
  }
  return dist
}

function printDistribution(label: string, d: Distribution) {
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

// ── Main loop ─────────────────────────────────────────────────

async function fetchBatch(offset: number): Promise<Spot[]> {
  // Idempotency: WHERE workability_score IS NULL OR workability_scored_at < (now - 90 days)
  // Implemented as two ORed predicates because supabase-js doesn't expose a
  // single OR with NULL handling cleanly — `.or()` accepts it as a string.
  // We restrict to approved spots; rejected/pending shouldn't burn budget.
  let query = supabase
    .from('spots')
    .select('*')
    .eq('status', 'approved')
    .order('created_at', { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1)

  if (!isForce) {
    const staleCutoff = new Date(Date.now() - STALENESS_DAYS * 24 * 60 * 60 * 1000).toISOString()
    query = query.or(`workability_score.is.null,workability_scored_at.lt.${staleCutoff}`)
  }

  const { data, error } = await query
  if (error) throw new Error(`fetchBatch failed: ${error.message}`)
  return (data ?? []) as Spot[]
}

/** Run an async fn over a list with bounded concurrency. */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

async function main() {
  console.log(`[curator] Starting. dry-run=${isDryRun} force=${isForce} limit=${LIMIT === Infinity ? '∞' : LIMIT} cost-cap=$${COST_CAP_USD.toFixed(2)} concurrency=${CONCURRENCY} model=${DEFAULT_MODEL}`)

  const before = await snapshotDistribution('BEFORE')
  printDistribution('BEFORE', before)

  let totalCostUsd = 0
  let processed = 0
  let updated = 0
  let failed = 0
  let offset = 0
  let costCapHit = false

  outer: while (processed < LIMIT) {
    const batch = await fetchBatch(offset)
    if (batch.length === 0) break

    const remaining = LIMIT - processed
    const work = batch.slice(0, remaining)
    offset += batch.length

    const results = await mapWithConcurrency(work, CONCURRENCY, async (spot, idx) => {
      const result = await scoreSpot(spot)
      const tag = result.ok
        ? `✓ ${result.score.toFixed(1)}`
        : `✗ ${result.reason.slice(0, 80)}`
      console.log(
        `  [${String(processed + idx + 1).padStart(4)}] ${spot.type.padEnd(12)} ${spot.name.slice(0, 38).padEnd(38)} ${tag}`
      )
      return { spot, result }
    })

    // Persist sequentially so an early cost-cap abort still saves what we
    // already paid for.
    for (const { spot, result } of results) {
      processed++
      if (!result.ok) {
        failed++
        totalCostUsd += result.costUsd
        continue
      }
      totalCostUsd += result.costUsd

      if (!isDryRun) {
        const { error } = await supabase
          .from('spots')
          .update({
            workability_score: result.score,
            workability_reasoning: result.reasoning,
            workability_scored_at: new Date().toISOString(),
          })
          .eq('id', spot.id)
        if (error) {
          console.error(`  ⚠ DB update failed for ${spot.id}: ${error.message}`)
          failed++
        } else {
          updated++
        }
      }

      // Hard stop if we've burned through the cap. We honor the cap
      // strictly because the user explicitly capped this at $2 to avoid
      // surprise spend on a future bad prompt or a 10k-row dataset.
      if (totalCostUsd >= COST_CAP_USD) {
        console.warn(
          `[curator] Cost cap $${COST_CAP_USD.toFixed(2)} reached after ${processed} rows (spent $${totalCostUsd.toFixed(4)}). Stopping.`
        )
        costCapHit = true
        break outer
      }
    }
  }

  const after = await snapshotDistribution('AFTER')
  printDistribution('AFTER', after)

  // Summary.
  const viableBefore = (before.buckets['6-8'] ?? 0) + (before.buckets['8-10'] ?? 0)
  const viableAfter = (after.buckets['6-8'] ?? 0) + (after.buckets['8-10'] ?? 0)
  const totalScoredAfter = after.scored
  console.log(`\n── Curator summary ────────────────────────────`)
  console.log(`  processed:       ${processed}`)
  console.log(`  updated:         ${updated}${isDryRun ? ' (dry-run, no writes)' : ''}`)
  console.log(`  failed:          ${failed}`)
  console.log(`  cost (USD):      $${totalCostUsd.toFixed(4)}  (cap $${COST_CAP_USD.toFixed(2)}${costCapHit ? ' — HIT' : ''})`)
  console.log(`  viable (≥6):     before=${viableBefore}  after=${viableAfter}  (of ${totalScoredAfter} scored)`)
  if (totalScoredAfter > 0) {
    const viablePct = Math.round((viableAfter / totalScoredAfter) * 100)
    console.log(`  viable share:    ${viablePct}% (target: 40–60% drop from 100% review-only baseline)`)
  }

  if (failed > 0 && processed > 0 && failed / processed > 0.1) {
    // High failure rate is worth surfacing in logs, but we no longer bail
    // with exit(2) — that was preventing the backlog from draining. Failed
    // rows stay null and get picked up by the next run; the cause should
    // be investigated separately (see /admin/ops for the failure trend).
    console.error(`[curator] WARN: ${failed}/${processed} rows failed (>10%). Continuing — failed rows will be retried next run.`)
  }
}

main().catch((e) => {
  console.error('[curator] FATAL:', e)
  process.exit(1)
})
