// ─────────────────────────────────────────────────────────────
// src/lib/admin/ops-queries.ts
//
// One-stop snapshot of every cafelist agent for the /admin/ops
// dashboard. Each helper returns a small typed shape that the page
// can render directly — no shared types yet because the agents have
// genuinely different signals.
//
// Reads via the service-role client (server-only). Always returns
// non-throwing fallbacks so a single agent's table being missing
// can't take down the whole page.
// ─────────────────────────────────────────────────────────────

import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase'

// ── Scout ─────────────────────────────────────────────────────

export interface ScoutSnapshot {
  configured: boolean
  lastRun: {
    started_at: string
    finished_at: string | null
    status: string
    city: string | null
    neighborhood: string | null
    candidates_examined: number
    candidates_inserted: number
    total_cost_usd: number
    error_message: string | null
  } | null
  runsLast24h: number
  spendLast24h: number
  capDaily: number
  recentRuns: Array<{
    run_id: string
    started_at: string
    status: string
    city: string | null
    candidates_inserted: number
    total_cost_usd: number
  }>
  // How many priority rows are due to scout.
  queueDue: number | null
}

export async function getScoutSnapshot(): Promise<ScoutSnapshot> {
  const empty: ScoutSnapshot = {
    configured: isSupabaseConfigured(),
    lastRun: null,
    runsLast24h: 0,
    spendLast24h: 0,
    capDaily: 3,
    recentRuns: [],
    queueDue: null,
  }
  if (!isSupabaseConfigured()) return empty

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [recentRes, dayRes, queueRes] = await Promise.all([
    supabaseAdmin
      .from('scout_runs')
      .select(
        'run_id, started_at, finished_at, status, city, neighborhood, candidates_examined, candidates_inserted, total_cost_usd, error_message',
      )
      .order('started_at', { ascending: false })
      .limit(10),
    supabaseAdmin
      .from('scout_runs')
      .select('total_cost_usd')
      .gte('started_at', since24h),
    supabaseAdmin
      .from('scout_priority')
      .select('id', { count: 'exact', head: true })
      .or('last_scouted_at.is.null,last_scouted_at.lt.' + sevenDaysAgo()),
  ])

  const recent = recentRes.data ?? []
  const last = recent[0] ?? null

  const spend = (dayRes.data ?? []).reduce(
    (sum: number, r: { total_cost_usd: number | null }) =>
      sum + Number(r.total_cost_usd ?? 0),
    0,
  )

  return {
    configured: true,
    lastRun: last
      ? {
          started_at: last.started_at,
          finished_at: last.finished_at,
          status: last.status,
          city: last.city,
          neighborhood: last.neighborhood,
          candidates_examined: last.candidates_examined,
          candidates_inserted: last.candidates_inserted,
          total_cost_usd: Number(last.total_cost_usd ?? 0),
          error_message: last.error_message,
        }
      : null,
    runsLast24h: dayRes.data?.length ?? 0,
    spendLast24h: spend,
    capDaily: 3,
    recentRuns: recent.slice(0, 5).map((r) => ({
      run_id: r.run_id,
      started_at: r.started_at,
      status: r.status,
      city: r.city,
      candidates_inserted: r.candidates_inserted,
      total_cost_usd: Number(r.total_cost_usd ?? 0),
    })),
    queueDue: queueRes.count ?? null,
  }
}

// ── Curator ───────────────────────────────────────────────────

export interface CuratorSnapshot {
  configured: boolean
  scoredAllTime: number
  scoredLast24h: number
  pendingRescore: number
  // Most recent workability_scored_at timestamp anywhere in spots.
  lastScoredAt: string | null
  // Distribution of the most recently scored 200 rows, used as a
  // health signal — viable_share = pct >= 6.
  viableShare: number | null
  avgWorkability: number | null
}

export async function getCuratorSnapshot(): Promise<CuratorSnapshot> {
  const empty: CuratorSnapshot = {
    configured: isSupabaseConfigured(),
    scoredAllTime: 0,
    scoredLast24h: 0,
    pendingRescore: 0,
    lastScoredAt: null,
    viableShare: null,
    avgWorkability: null,
  }
  if (!isSupabaseConfigured()) return empty

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const ninetyDaysAgo = new Date(
    Date.now() - 90 * 24 * 60 * 60 * 1000,
  ).toISOString()

  const [allTimeRes, dayRes, pendingRes, lastRes, sampleRes] =
    await Promise.all([
      supabaseAdmin
        .from('spots')
        .select('id', { count: 'exact', head: true })
        .not('workability_score', 'is', null),
      supabaseAdmin
        .from('spots')
        .select('id', { count: 'exact', head: true })
        .gte('workability_scored_at', since24h),
      supabaseAdmin
        .from('spots')
        .select('id', { count: 'exact', head: true })
        .or(
          'workability_score.is.null,workability_scored_at.lt.' + ninetyDaysAgo,
        ),
      supabaseAdmin
        .from('spots')
        .select('workability_scored_at')
        .not('workability_scored_at', 'is', null)
        .order('workability_scored_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from('spots')
        .select('workability_score')
        .not('workability_score', 'is', null)
        .order('workability_scored_at', { ascending: false })
        .limit(200),
    ])

  const sample = (sampleRes.data ?? []) as Array<{
    workability_score: number | null
  }>
  const scores = sample
    .map((r) => Number(r.workability_score))
    .filter((n) => Number.isFinite(n))
  const avg =
    scores.length > 0
      ? scores.reduce((s, n) => s + n, 0) / scores.length
      : null
  const viable =
    scores.length > 0
      ? scores.filter((n) => n >= 6).length / scores.length
      : null

  return {
    configured: true,
    scoredAllTime: allTimeRes.count ?? 0,
    scoredLast24h: dayRes.count ?? 0,
    pendingRescore: pendingRes.count ?? 0,
    lastScoredAt:
      (lastRes.data as { workability_scored_at: string } | null)
        ?.workability_scored_at ?? null,
    viableShare: viable,
    avgWorkability: avg,
  }
}

// ── Coverage Gap ──────────────────────────────────────────────

export interface CoverageGapSnapshot {
  configured: boolean
  // Aggregate of agent_query_logs over the last 7 days.
  queriesLast7d: number
  failureModesLast7d: Record<string, number>
  // Last time a row was upserted into scout_priority with
  // source = 'coverage_gap'.
  lastUpsertAt: string | null
  activeCoverageGapPriorities: number
}

export async function getCoverageGapSnapshot(): Promise<CoverageGapSnapshot> {
  const empty: CoverageGapSnapshot = {
    configured: isSupabaseConfigured(),
    queriesLast7d: 0,
    failureModesLast7d: {},
    lastUpsertAt: null,
    activeCoverageGapPriorities: 0,
  }
  if (!isSupabaseConfigured()) return empty

  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [logsRes, priRes, latestPriRes] = await Promise.all([
    supabaseAdmin
      .from('agent_query_logs')
      .select('failure_mode')
      .gte('created_at', since7d),
    supabaseAdmin
      .from('scout_priority')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'coverage_gap'),
    supabaseAdmin
      .from('scout_priority')
      .select('updated_at')
      .eq('source', 'coverage_gap')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const logs = (logsRes.data ?? []) as Array<{ failure_mode: string | null }>
  const byMode: Record<string, number> = {}
  for (const r of logs) {
    const k = r.failure_mode ?? 'ok'
    byMode[k] = (byMode[k] ?? 0) + 1
  }

  return {
    configured: true,
    queriesLast7d: logs.length,
    failureModesLast7d: byMode,
    lastUpsertAt:
      (latestPriRes.data as { updated_at: string } | null)?.updated_at ?? null,
    activeCoverageGapPriorities: priRes.count ?? 0,
  }
}

// ── Prompt Optimizer ──────────────────────────────────────────

export interface OptimizerSnapshot {
  configured: boolean
  totalRounds: number
  lastRound: {
    round_id: string
    stage: string | null
    started_at: string
    promoted_variant: string | null
    baseline_quality: number | null
    winner_quality: number | null
    total_cost_usd: number
  } | null
}

export async function getOptimizerSnapshot(): Promise<OptimizerSnapshot> {
  const empty: OptimizerSnapshot = {
    configured: isSupabaseConfigured(),
    totalRounds: 0,
    lastRound: null,
  }
  if (!isSupabaseConfigured()) return empty

  // Latest round = newest created_at; every row in that round shares
  // the same round_id. We aggregate the round inline (no second round
  // pass needed beyond the count).
  const { data: latestRoundRow } = await supabaseAdmin
    .from('agent_prompt_runs')
    .select('round_id, stage, created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!latestRoundRow) return empty

  const round = latestRoundRow as {
    round_id: string
    stage: string | null
    created_at: string
  }

  const [allRoundsRes, roundDetailRes] = await Promise.all([
    supabaseAdmin.from('agent_prompt_runs').select('round_id'),
    supabaseAdmin
      .from('agent_prompt_runs')
      .select(
        'variant_id, strategy, promoted, avg_quality, baseline_avg_quality, cost_usd',
      )
      .eq('round_id', round.round_id),
  ])

  const allRows = (allRoundsRes.data ?? []) as Array<{ round_id: string }>
  const uniqueRounds = new Set(allRows.map((r) => r.round_id))

  const detail = (roundDetailRes.data ?? []) as Array<{
    variant_id: string
    strategy: string | null
    promoted: boolean | null
    avg_quality: number | null
    baseline_avg_quality: number | null
    cost_usd: number | null
  }>
  const baselineRow =
    detail.find((r) => (r.strategy ?? '').toLowerCase() === 'baseline') ?? null
  const winner = detail.find((r) => r.promoted === true) ?? null
  const baselineQuality =
    baselineRow?.avg_quality != null
      ? Number(baselineRow.avg_quality)
      : detail.find((r) => r.baseline_avg_quality != null)
            ?.baseline_avg_quality != null
        ? Number(
            detail.find((r) => r.baseline_avg_quality != null)!
              .baseline_avg_quality,
          )
        : null
  const cost = detail.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0)

  return {
    configured: true,
    totalRounds: uniqueRounds.size,
    lastRound: {
      round_id: round.round_id,
      stage: round.stage,
      started_at: round.created_at,
      promoted_variant: winner?.variant_id ?? null,
      baseline_quality: baselineQuality,
      winner_quality:
        winner?.avg_quality != null ? Number(winner.avg_quality) : null,
      total_cost_usd: cost,
    },
  }
}

// ── Labs Eval ─────────────────────────────────────────────────

export interface EvalSnapshot {
  configured: boolean
  totalRuns: number
  lastRun: {
    run_id: string
    started_at: string
    total_cases: number
    total_pass: number
    avg_quality: number
    total_cost_usd: number
    git_sha: string | null
  } | null
}

export async function getEvalSnapshot(): Promise<EvalSnapshot> {
  const empty: EvalSnapshot = {
    configured: isSupabaseConfigured(),
    totalRuns: 0,
    lastRun: null,
  }
  if (!isSupabaseConfigured()) return empty

  const [countRes, lastRes] = await Promise.all([
    supabaseAdmin
      .from('agent_eval_runs')
      .select('run_id', { count: 'exact', head: true }),
    supabaseAdmin
      .from('agent_eval_runs')
      .select(
        'run_id, started_at, total_cases, total_pass, avg_quality, total_cost_usd, git_sha',
      )
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const last = (lastRes.data ?? null) as EvalSnapshot['lastRun']

  return {
    configured: true,
    totalRuns: countRes.count ?? 0,
    lastRun: last
      ? {
          ...last,
          avg_quality: Number(last.avg_quality ?? 0),
          total_cost_usd: Number(last.total_cost_usd ?? 0),
        }
      : null,
  }
}

// ── Aggregator ────────────────────────────────────────────────

export interface OpsSnapshot {
  scout: ScoutSnapshot
  curator: CuratorSnapshot
  coverageGap: CoverageGapSnapshot
  optimizer: OptimizerSnapshot
  eval: EvalSnapshot
  fetchedAt: string
}

export async function getOpsSnapshot(): Promise<OpsSnapshot> {
  const [scout, curator, coverageGap, optimizer, evalSnap] = await Promise.all([
    getScoutSnapshot().catch(() => emptyScout()),
    getCuratorSnapshot().catch(() => emptyCurator()),
    getCoverageGapSnapshot().catch(() => emptyCoverage()),
    getOptimizerSnapshot().catch(() => emptyOptimizer()),
    getEvalSnapshot().catch(() => emptyEval()),
  ])

  return {
    scout,
    curator,
    coverageGap,
    optimizer,
    eval: evalSnap,
    fetchedAt: new Date().toISOString(),
  }
}

// ── helpers ───────────────────────────────────────────────────

function sevenDaysAgo(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
}

function emptyScout(): ScoutSnapshot {
  return {
    configured: false,
    lastRun: null,
    runsLast24h: 0,
    spendLast24h: 0,
    capDaily: 3,
    recentRuns: [],
    queueDue: null,
  }
}
function emptyCurator(): CuratorSnapshot {
  return {
    configured: false,
    scoredAllTime: 0,
    scoredLast24h: 0,
    pendingRescore: 0,
    lastScoredAt: null,
    viableShare: null,
    avgWorkability: null,
  }
}
function emptyCoverage(): CoverageGapSnapshot {
  return {
    configured: false,
    queriesLast7d: 0,
    failureModesLast7d: {},
    lastUpsertAt: null,
    activeCoverageGapPriorities: 0,
  }
}
function emptyOptimizer(): OptimizerSnapshot {
  return { configured: false, totalRounds: 0, lastRound: null }
}
function emptyEval(): EvalSnapshot {
  return { configured: false, totalRuns: 0, lastRun: null }
}
