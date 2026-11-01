/**
 * Curator Agent — core run loop.
 *
 * Shared between scripts/curate-workability.ts (CLI) and
 * src/app/api/curate/route.ts (HTTP entrypoint for the scheduled task).
 * Mirrors the lib/scout.ts + api/scout/route.ts split so both agents
 * follow the same pattern and don't drift apart on cost caps, batching,
 * etc.
 *
 * Background: this logic used to live only in scripts/curate-workability.ts
 * as a CLI-only script. Nothing ever called it on a schedule — vercel.json
 * only scheduled /api/scout — so workability_score silently never refreshed
 * after its initial one-time backfill, and data_confidence could never
 * reach 'verified' as a result (see supabase/migrations/
 * 20261031_outlet_status_and_data_confidence.sql for how that gate works).
 * This file is the fix: the scoring logic now lives here as a plain
 * importable function, callable from both the CLI script and a real
 * Vercel Cron-triggered route, the same way runScout() is.
 *
 * Note: this agent intentionally never writes last_verified_at — that
 * column is only ever stamped at admin-approval time (see lib/spots.ts).
 * workability_score is a vibe/fit signal, not a verification event.
 *
 * Overlap guard: runCurator() acquires a lock in the curator_runs table
 * (supabase/migrations/20261031_curator_runs.sql — PREPARED, NOT YET
 * APPLIED to production as of this writing; applying a migration is a
 * production-DB write and needs explicit approval, same as merging this
 * PR) before doing any scoring. The lock is a real Postgres constraint
 * (a partial unique index on status='running'), not an application-level
 * check, so it's race-free even under two near-simultaneous invocations.
 * Until that migration is applied, acquireLock() detects the missing
 * table and *fails open* (logs a warning, proceeds without the lock)
 * rather than refusing to run — same "don't let optional telemetry block
 * the main loop" convention lib/scout.ts already uses for scout_runs.
 * That means there is NO overlap protection yet on this branch; it exists
 * in code and is ready the moment the migration lands.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { callClaudeJson, DEFAULT_MODEL } from './labs/anthropic'
import type { Spot } from '../types'

// A run holds the lock for at most this long before a later caller is
// allowed to treat it as dead (crashed, hard-timed-out) and sweep it.
// Comfortably above api/curate/route.ts's maxDuration=90s, comfortably
// below the ~24h gap between daily cron invocations.
export const CURATOR_LOCK_STALE_MINUTES = 15

// ── Tunable constants ─────────────────────────────────────────

// Rows older than this are considered stale and re-scored. 90 days
// matches the data_confidence gate in the migration above — venues
// open/close/change hours and the score should drift with reality,
// not be a one-time stamp.
export const STALENESS_DAYS = 90

// Default USD ceiling per run. The user explicitly capped this at $2
// to avoid surprise spend on a bad prompt or a much larger dataset.
export const DEFAULT_COST_CAP_USD = 2.0

// Default page size for the unscored-rows query.
const PAGE_SIZE = 50

// Default row cap for an HTTP/cron-triggered run. A cron invocation runs
// inside a time-boxed serverless function (see api/curate/route.ts's
// maxDuration), so each invocation processes a bounded batch rather than
// trying to clear the whole backlog at once. Running daily, this still
// catches the backlog up within a few days and then keeps up with the
// 90-day staleness window going forward. CLI usage is unaffected — it
// keeps its own existing default of "no limit unless --limit is passed".
export const DEFAULT_CRON_LIMIT = 50

// ── Types ─────────────────────────────────────────────────────

export interface CuratorOptions {
  dryRun?: boolean
  /** Ignore the staleness gate and re-score every approved row. */
  force?: boolean
  /** Cap on rows processed this run. Defaults to unlimited for CLI-style
   * callers; api/curate/route.ts passes DEFAULT_CRON_LIMIT explicitly. */
  limit?: number
  costCapUsd?: number
  concurrency?: number
  logger?: (msg: string) => void
}

export interface Distribution {
  total: number
  scored: number
  unscored: number
  buckets: Record<string, number>
  byType: Record<string, { total: number; viable_ge_6: number; avg: number | null }>
}

export type CuratorRunStatus = 'success' | 'partial' | 'cap_hit' | 'error' | 'already_running'

export interface CuratorResult {
  status: CuratorRunStatus
  processed: number
  updated: number
  failed: number
  costUsd: number
  costCapUsd: number
  costCapHit: boolean
  before: Distribution
  after: Distribution
  error_message?: string | null
  /** Set once curator_runs exists; null if the lock table isn't there yet
   * (migration not applied) or the lock couldn't be written for another
   * reason — in which case this run proceeded WITHOUT overlap protection. */
  runId?: string | null
  lockHeld?: boolean
}

interface CuratorOutput {
  score: number
  reasoning: string
}

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

/** Score one spot. Returns ok:false on unrecoverable error so the batch
 * can skip and continue rather than crashing the whole run. */
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
      maxTokens: 200,
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

async function snapshotDistribution(
  supabase: SupabaseClient,
  logger: (msg: string) => void
): Promise<Distribution> {
  const { data, error } = await supabase
    .from('spots')
    .select('type, workability_score')
    .eq('status', 'approved')

  if (error) {
    logger(`[curator] Failed to read distribution: ${error.message}`)
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
      const prevAvg = t.avg ?? 0
      t.avg = prevAvg + (s - prevAvg) / t.total
    }
    dist.byType[r.type] = t
  }

  for (const k of Object.keys(dist.byType)) {
    const v = dist.byType[k]
    v.avg = v.avg === null ? null : Math.round(v.avg * 100) / 100
  }
  return dist
}

async function fetchBatch(
  supabase: SupabaseClient,
  offset: number,
  force: boolean
): Promise<Spot[]> {
  // Idempotency: WHERE workability_score IS NULL OR workability_scored_at < (now - 90 days)
  // Restricted to approved spots; rejected/pending shouldn't burn budget.
  let query = supabase
    .from('spots')
    .select('*')
    .eq('status', 'approved')
    .order('created_at', { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1)

  if (!force) {
    const staleCutoff = new Date(Date.now() - STALENESS_DAYS * 24 * 60 * 60 * 1000).toISOString()
    query = query.or(`workability_score.is.null,workability_scored_at.lt.${staleCutoff}`)
  }

  const { data, error } = await query
  if (error) throw new Error(`fetchBatch failed: ${error.message}`)
  return (data ?? []) as Spot[]
}

// ── Overlap guard (curator_runs lock) ─────────────────────────

const MISSING_TABLE_CODES = new Set(['42P01']) // undefined_table
const UNIQUE_VIOLATION_CODE = '23505'

/** Sweep any 'running' row older than CURATOR_LOCK_STALE_MINUTES to
 * 'error' so a crashed/hard-timed-out run can't wedge the lock forever.
 * Best-effort: a failure here just means acquireLock() will find out
 * directly when it tries to insert. */
async function sweepStaleLock(supabase: SupabaseClient, logger: (msg: string) => void): Promise<void> {
  const staleCutoff = new Date(Date.now() - CURATOR_LOCK_STALE_MINUTES * 60 * 1000).toISOString()
  const { error } = await supabase
    .from('curator_runs')
    .update({ status: 'error', error_message: 'stale lock swept by a later run', finished_at: new Date().toISOString() })
    .eq('status', 'running')
    .lt('started_at', staleCutoff)
  if (error && !MISSING_TABLE_CODES.has(error.code ?? '')) {
    logger(`[curator] ⚠ Couldn't sweep stale lock: ${error.message}`)
  }
}

/**
 * Tries to acquire the curator_runs lock (INSERT with status='running',
 * guarded by a partial unique index — see the migration). Three outcomes:
 *   - { ok: true, runId }       — lock acquired, caller should proceed
 *   - { ok: false, reason: 'already_running' } — a real lock is held;
 *     caller must NOT proceed (no LLM calls, no cost).
 *   - { ok: false, reason: 'no_lock_table' }    — curator_runs doesn't
 *     exist yet (migration not applied). Caller proceeds WITHOUT a lock
 *     (fail-open), same as scout_runs' existing degrade-gracefully
 *     convention — this is NOT a safe default to rely on long-term, just
 *     a bridge until the migration lands.
 */
async function acquireLock(
  supabase: SupabaseClient,
  dryRun: boolean,
  costCapUsd: number,
  logger: (msg: string) => void
): Promise<{ ok: true; runId: string } | { ok: false; reason: 'already_running' | 'no_lock_table' }> {
  await sweepStaleLock(supabase, logger)

  const { data, error } = await supabase
    .from('curator_runs')
    .insert({ status: 'running', dry_run: dryRun, cost_cap_usd: costCapUsd })
    .select('run_id')
    .single()

  if (!error) {
    return { ok: true, runId: (data as { run_id: string }).run_id }
  }

  if (error.code === UNIQUE_VIOLATION_CODE) {
    logger('[curator] Another curator run is already in progress. Aborting — no LLM calls made.')
    return { ok: false, reason: 'already_running' }
  }

  if (MISSING_TABLE_CODES.has(error.code ?? '') || /curator_runs/i.test(error.message)) {
    logger(
      '[curator] ⚠ curator_runs table not found (migration 20261031_curator_runs.sql not yet applied) — proceeding WITHOUT an overlap guard.'
    )
    return { ok: false, reason: 'no_lock_table' }
  }

  // Unknown error — fail open rather than block the agent entirely, but
  // surface it loudly since this is unexpected.
  logger(`[curator] ⚠ Couldn't acquire curator_runs lock (${error.message}) — proceeding WITHOUT an overlap guard.`)
  return { ok: false, reason: 'no_lock_table' }
}

async function releaseLock(
  supabase: SupabaseClient,
  runId: string | null,
  patch: {
    status: Exclude<CuratorRunStatus, 'already_running'>
    processed: number
    updated: number
    failed: number
    costUsd: number
    errorMessage?: string | null
  },
  logger: (msg: string) => void
): Promise<void> {
  if (!runId) return
  const { error } = await supabase
    .from('curator_runs')
    .update({
      status: patch.status,
      processed: patch.processed,
      updated: patch.updated,
      failed: patch.failed,
      cost_usd: patch.costUsd,
      error_message: patch.errorMessage ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq('run_id', runId)
  if (error) {
    logger(`[curator] ⚠ Couldn't release curator_runs lock cleanly: ${error.message}`)
  }
}

// ── Main entrypoint ───────────────────────────────────────────

/**
 * Runs one Curator pass: scores unscored/stale approved spots with
 * workability_score, up to `limit` rows or `costCapUsd`, whichever
 * comes first. Idempotent — safe to call repeatedly (CLI, cron, or
 * an ops-dashboard "Run curator now" button) without coordination.
 */
export async function runCurator(
  supabase: SupabaseClient,
  options: CuratorOptions = {}
): Promise<CuratorResult> {
  const {
    dryRun = false,
    force = false,
    limit = Number.POSITIVE_INFINITY,
    costCapUsd = DEFAULT_COST_CAP_USD,
    concurrency = 4,
    logger = () => {},
  } = options

  logger(
    `[curator] Starting. dry-run=${dryRun} force=${force} limit=${limit === Infinity ? '∞' : limit} cost-cap=$${costCapUsd.toFixed(2)} concurrency=${concurrency} model=${DEFAULT_MODEL}`
  )

  const lock = await acquireLock(supabase, dryRun, costCapUsd, logger)
  if (!lock.ok && lock.reason === 'already_running') {
    // A real lock is held by another in-flight run. Abort before any LLM
    // call or DB read — this run does nothing and costs nothing.
    const empty: Distribution = { total: 0, scored: 0, unscored: 0, buckets: {}, byType: {} }
    return {
      status: 'already_running',
      processed: 0,
      updated: 0,
      failed: 0,
      costUsd: 0,
      costCapUsd,
      costCapHit: false,
      before: empty,
      after: empty,
      error_message: null,
      runId: null,
      lockHeld: false,
    }
  }
  const runId = lock.ok ? lock.runId : null
  const lockHeld = lock.ok

  const before = await snapshotDistribution(supabase, logger)

  let totalCostUsd = 0
  let processed = 0
  let updated = 0
  let failed = 0
  let offset = 0
  let costCapHit = false
  let errorMessage: string | null = null

  try {
    outer: while (processed < limit) {
      const batch = await fetchBatch(supabase, offset, force)
      if (batch.length === 0) break

      const remaining = limit - processed
      const work = batch.slice(0, remaining)
      offset += batch.length

      const results = await mapWithConcurrency(work, concurrency, async (spot, idx) => {
        const result = await scoreSpot(spot)
        const tag = result.ok ? `✓ ${result.score.toFixed(1)}` : `✗ ${result.reason.slice(0, 80)}`
        logger(
          `  [${String(processed + idx + 1).padStart(4)}] ${spot.type.padEnd(12)} ${spot.name.slice(0, 38).padEnd(38)} ${tag}`
        )
        return { spot, result }
      })

      for (const { spot, result } of results) {
        processed++
        if (!result.ok) {
          failed++
          totalCostUsd += result.costUsd
          continue
        }
        totalCostUsd += result.costUsd

        if (!dryRun) {
          const { error } = await supabase
            .from('spots')
            .update({
              workability_score: result.score,
              workability_reasoning: result.reasoning,
              workability_scored_at: new Date().toISOString(),
            })
            .eq('id', spot.id)
          if (error) {
            logger(`  ⚠ DB update failed for ${spot.id}: ${error.message}`)
            failed++
          } else {
            updated++
          }
        }

        if (totalCostUsd >= costCapUsd) {
          logger(
            `[curator] Cost cap $${costCapUsd.toFixed(2)} reached after ${processed} rows (spent $${totalCostUsd.toFixed(4)}). Stopping.`
          )
          costCapHit = true
          break outer
        }
      }
    }
  } catch (e) {
    errorMessage = (e as Error).message
    logger(`[curator] FATAL: ${errorMessage}`)
  }

  const after = await snapshotDistribution(supabase, logger)

  let status: CuratorRunStatus
  if (errorMessage) status = 'error'
  else if (costCapHit) status = 'cap_hit'
  else if (failed > 0 && processed > 0 && failed / processed > 0.1) status = 'partial'
  else status = 'success'

  logger(`\n── Curator summary ────────────────────────────`)
  logger(`  processed:       ${processed}`)
  logger(`  updated:         ${updated}${dryRun ? ' (dry-run, no writes)' : ''}`)
  logger(`  failed:          ${failed}`)
  logger(`  cost (USD):      $${totalCostUsd.toFixed(4)}  (cap $${costCapUsd.toFixed(2)}${costCapHit ? ' — HIT' : ''})`)

  await releaseLock(
    supabase,
    runId,
    {
      status,
      processed,
      updated,
      failed,
      costUsd: totalCostUsd,
      errorMessage,
    },
    logger
  )

  return {
    status,
    processed,
    updated,
    failed,
    costUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
    costCapUsd,
    costCapHit,
    before,
    after,
    error_message: errorMessage,
    runId,
    lockHeld,
  }
}
