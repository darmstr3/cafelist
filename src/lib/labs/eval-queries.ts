// ─────────────────────────────────────────────────────────────
// Server-only Supabase queries for the /labs/eval dashboard.
//
// All reads use the public anon client (eval tables expose
// public-read RLS policies). Pure functions; no caching besides
// Next.js route-level caching. Each call returns the rows we
// directly need so the page components stay shapeless.
// ─────────────────────────────────────────────────────────────

import 'server-only'

import { supabase } from '@/lib/supabase'
import type { AgentRun } from './types'
import type { HardConstraints } from './eval-checks'

export interface EvalRunRow {
  run_id: string
  started_at: string
  finished_at: string | null
  git_sha: string | null
  prompt_versions: Record<string, string>
  total_cases: number
  total_pass: number
  avg_quality: number
  total_cost_usd: number
  note: string | null
}

export interface EvalCaseRow {
  case_id: string
  query: string
  hard_constraints: HardConstraints
  tags: string[]
  created_at: string
  retired_at: string | null
}

export interface EvalResultRow {
  id: string
  run_id: string
  case_id: string
  pass_deterministic: boolean
  pass_judge: boolean | null
  quality_score: number | null
  latency_ms: number
  cost_usd: number
  deterministic_fails: string[]
  full_trace: AgentRun
  created_at: string
}

// ── Runs ─────────────────────────────────────────────────────

export async function getRecentRuns(limit = 30): Promise<EvalRunRow[]> {
  const { data, error } = await supabase
    .from('agent_eval_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`getRecentRuns: ${error.message}`)
  return (data ?? []) as EvalRunRow[]
}

export async function getLatestRun(): Promise<EvalRunRow | null> {
  const rows = await getRecentRuns(1)
  return rows[0] ?? null
}

// ── Cases ────────────────────────────────────────────────────

export async function getActiveCases(): Promise<EvalCaseRow[]> {
  const { data, error } = await supabase
    .from('agent_eval_cases')
    .select('*')
    .is('retired_at', null)
    .order('case_id', { ascending: true })
  if (error) throw new Error(`getActiveCases: ${error.message}`)
  return (data ?? []) as EvalCaseRow[]
}

export async function getCase(caseId: string): Promise<EvalCaseRow | null> {
  const { data, error } = await supabase
    .from('agent_eval_cases')
    .select('*')
    .eq('case_id', caseId)
    .maybeSingle()
  if (error) throw new Error(`getCase: ${error.message}`)
  return (data ?? null) as EvalCaseRow | null
}

// ── Results ──────────────────────────────────────────────────

/** Results for a single run, joined with the case slug as the key. */
export async function getResultsForRun(runId: string): Promise<EvalResultRow[]> {
  const { data, error } = await supabase
    .from('agent_eval_results')
    .select('*')
    .eq('run_id', runId)
    .order('case_id', { ascending: true })
  if (error) throw new Error(`getResultsForRun: ${error.message}`)
  return (data ?? []) as EvalResultRow[]
}

/** All historical results for a single case, newest first. */
export async function getResultsForCase(
  caseId: string,
  limit = 30
): Promise<EvalResultRow[]> {
  const { data, error } = await supabase
    .from('agent_eval_results')
    .select('*')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`getResultsForCase: ${error.message}`)
  return (data ?? []) as EvalResultRow[]
}

/** Per-case latest result for the given runs, keyed by `${runId}:${caseId}`. */
export async function getResultsMatrix(
  runIds: string[]
): Promise<Map<string, EvalResultRow>> {
  if (runIds.length === 0) return new Map()
  const { data, error } = await supabase
    .from('agent_eval_results')
    .select('*')
    .in('run_id', runIds)
  if (error) throw new Error(`getResultsMatrix: ${error.message}`)
  const map = new Map<string, EvalResultRow>()
  for (const r of (data ?? []) as EvalResultRow[]) {
    map.set(`${r.run_id}:${r.case_id}`, r)
  }
  return map
}
