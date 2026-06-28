/**
 * CafeList Loop Runner — Type Definitions
 *
 * All shared types for the loop runner system. These are used by:
 *  - The runner orchestrator
 *  - Every loop maker/checker
 *  - The API route handler
 *  - The CLI
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ── Run lifecycle ─────────────────────────────────────────────────────────────

export type RunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'CHECKING'
  | 'NEEDS_REVISION'
  | 'AWAITING_HUMAN_REVIEW'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'FAILED'
  | 'SKIPPED'
  | 'BUDGET_EXHAUSTED'

export type FindingSeverity = 'BLOCKER' | 'MAJOR' | 'MINOR' | 'INFORMATIONAL'

export interface Finding {
  severity: FindingSeverity
  code: string
  message: string
  spot_id?: string
  spot_name?: string
  evidence?: Record<string, unknown>
}

// ── Registry ──────────────────────────────────────────────────────────────────

export interface LoopEntry {
  id: string
  enabled: boolean
  cron: string
  timezone: string
  runner: string
  description: string
  input: Record<string, unknown>
  output: {
    queue?: string
    state?: string
    log?: string
    report?: string
    priority_file?: string
  }
  max_items_per_run: number
  max_exec_time_ms: number
  max_iterations: number
  retry_limit: number
  cooldown_minutes: number
  requires_human_review: boolean
  allows_destructive: boolean
  supports_dry_run: boolean
}

export interface LoopRegistry {
  _version: number
  _description: string
  loops: LoopEntry[]
}

// ── State ─────────────────────────────────────────────────────────────────────

export interface LoopState {
  loop_id: string
  last_run_id: string | null
  last_run_at: string | null
  last_status: RunStatus | null
  last_cursor: unknown
  custom: Record<string, unknown>
}

// ── Maker / Checker contract ──────────────────────────────────────────────────

export interface MakerOutput {
  /** Items processed this run (e.g. stale spots, duplicate groups) */
  items: Array<Record<string, unknown>>
  /** Cursor to resume from on next run (e.g. last spot_id seen) */
  next_cursor: unknown
  /** True if there are more items beyond max_items_per_run */
  has_more: boolean
  /** Patch merged into LoopState.custom at end of run */
  state_patch: Record<string, unknown>
  /** Entries to write to the output queue */
  queue_entries: QueueEntry[]
  /** Human-readable summary written to loop_runs.maker_summary */
  summary: string
}

export interface CheckerOutput {
  /** True if no BLOCKER or MAJOR findings */
  passed: boolean
  findings: Finding[]
  /** Items the checker independently verified as correct */
  verified_count: number
  /** Items the checker could not verify or found problems with */
  rejected_count: number
  /** Human-readable summary written to loop_runs.checker_summary */
  summary: string
}

// ── Queue entries ─────────────────────────────────────────────────────────────

export interface QueueEntry {
  item_id: string
  severity: FindingSeverity
  why_flagged: string
  evidence: Record<string, unknown>
  recommended_action: string
  source: string
  loop_id: string
  run_id: string
  queued_at: string
  resolved_at: null
  resolution: null
  resolution_notes: null
}

// ── Run record (mirrors loop_runs table) ─────────────────────────────────────

export interface LoopRunRecord {
  run_id: string
  loop_id: string
  status: RunStatus
  started_at: string
  finished_at: string | null
  dry_run: boolean
  iteration: number
  items_processed: number
  items_queued: number
  maker_summary: string | null
  checker_summary: string | null
  findings: Finding[] | null
  state_snapshot: Record<string, unknown> | null
  error: string | null
  triggered_by: string
}

// ── Runner options ────────────────────────────────────────────────────────────

export interface RunOptions {
  dryRun?: boolean
  triggeredBy?: string
  maxItemsOverride?: number
  logger?: (msg: string) => void
}

// ── Loop maker/checker function signatures ────────────────────────────────────

export type MakerFn = (
  client: SupabaseClient,
  entry: LoopEntry,
  state: LoopState,
  options: RunOptions,
) => Promise<MakerOutput>

export type CheckerFn = (
  client: SupabaseClient,
  entry: LoopEntry,
  makerOutput: MakerOutput,
  options: RunOptions,
) => Promise<CheckerOutput>

export interface LoopImpl {
  maker: MakerFn
  checker: CheckerFn
}
