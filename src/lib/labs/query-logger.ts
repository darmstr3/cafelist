// ─────────────────────────────────────────────────────────────
// /labs query logger — append-only insert into agent_query_logs
// at the end of every recommend run. Powers the coverage-gap
// agent (which mines real query patterns to prioritise Scout).
//
// Failure-mode classification is deliberately rough: the goal is
// to surface dominant signal per (city, neighborhood), not to be
// forensically precise about why any single run was suboptimal.
// ─────────────────────────────────────────────────────────────

import { supabaseAdmin } from '@/lib/supabase'
import type { AgentRun, Evaluation, ParsedIntent, Recommendation, TraceEvent } from './types'

export type FailureMode =
  | 'ok'
  | 'no_data_in_db'
  | 'no_candidates'
  | 'closed_too_early'
  | 'too_loud'
  | 'low_quality'
  | 'fatal_error'

/**
 * Classify a run into a single dominant failure_mode. Order matters:
 * earlier branches win, so "fatal" overrides everything and "ok" is
 * only reached when nothing else flagged.
 */
export function classifyFailureMode(args: {
  fatal: boolean
  retrievalSource: 'supabase' | 'demo' | null
  candidateCount: number | null
  recommendation: Recommendation | null
  evaluation: Evaluation | null
}): FailureMode {
  const { fatal, retrievalSource, candidateCount, recommendation, evaluation } = args

  if (fatal) return 'fatal_error'
  if (retrievalSource === 'demo') return 'no_data_in_db'
  if (candidateCount === 0 || (recommendation && recommendation.picks.length === 0)) {
    return 'no_candidates'
  }

  // Inspect evaluator missed constraints for the two dominant
  // operational failure modes we want to surface to acquisition.
  const missed = (evaluation?.missedConstraints ?? []).map((m) => m.toLowerCase())
  const hasTime = missed.some((m) => /time|hour|open|close|late/.test(m))
  const hasNoise = missed.some((m) => /noise|loud|quiet|silent/.test(m))
  if (hasTime) return 'closed_too_early'
  if (hasNoise) return 'too_loud'

  if (evaluation && evaluation.qualityScore < 5) return 'low_quality'
  return 'ok'
}

function extractRetrieval(trace: TraceEvent[]): {
  source: 'supabase' | 'demo' | null
  candidateCount: number | null
} {
  const ev = trace.find((t) => t.stage === 'retriever')
  if (!ev || !ev.output || typeof ev.output !== 'object') {
    return { source: null, candidateCount: null }
  }
  const out = ev.output as { source?: unknown; candidates?: unknown }
  const source =
    out.source === 'supabase' || out.source === 'demo' ? out.source : null
  const candidateCount = Array.isArray(out.candidates) ? out.candidates.length : null
  return { source, candidateCount }
}

/**
 * Fire-and-forget insert. We log errors but never throw — the user
 * has already received their recommendation and the request must not
 * fail because telemetry hiccuped.
 */
export async function logAgentRun(args: {
  run: AgentRun
  intent: ParsedIntent | null
}): Promise<void> {
  const { run, intent } = args

  try {
    const { source: retrievalSource, candidateCount } = extractRetrieval(run.trace)
    const failureMode = classifyFailureMode({
      fatal: run.fatal,
      retrievalSource,
      candidateCount,
      recommendation: run.recommendation,
      evaluation: run.evaluation,
    })

    const topPickId = run.recommendation?.picks[0]?.spotId ?? null
    // Top-pick spotIds for demo data are not real UUIDs in the spots
    // table. Only persist the FK when retrieval actually hit supabase.
    const topPickFk =
      retrievalSource === 'supabase' && topPickId && isUuid(topPickId) ? topPickId : null

    const row = {
      query: run.query,
      parsed_intent: intent ?? null,
      city: intent?.city ?? null,
      neighborhood: intent?.neighborhood ?? null,
      top_pick_spot_id: topPickFk,
      recommendation_summary: run.recommendation?.summary ?? null,
      picks_count: run.recommendation?.picks.length ?? 0,
      quality_score: run.evaluation?.qualityScore ?? null,
      evaluation_pass: run.evaluation?.pass ?? null,
      failure_mode: failureMode,
      run_id: run.runId,
      total_duration_ms: run.totalDurationMs,
      total_cost_usd: run.totalCostUsd,
    }

    const { error } = await supabaseAdmin.from('agent_query_logs').insert(row)
    if (error) {
      console.warn('[query-logger] insert failed:', error.message)
    }
  } catch (err) {
    console.warn(
      '[query-logger] unexpected error:',
      err instanceof Error ? err.message : String(err)
    )
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}
