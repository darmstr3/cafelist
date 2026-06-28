// ─────────────────────────────────────────────────────────────
// src/lib/admin/growth-os-queries.ts
//
// Data layer for the /admin/growth-os dashboard.
//
// Phase 1: reads from /ai/runs/*.json files on disk (no new
// Supabase tables needed — the schema can be promoted later once
// the run format stabilizes). Uses Node fs to list and parse run
// files at server render time.
//
// Phase 2: also reads /ai/tasks/*.json for the Unblock Queue.
// Task dependency validation is FAIL-SAFE: if a blocked_by entry
// references a task ID that doesn't exist in the file, the
// dependent task is marked config_error — never silently unlocked.
//
// Pattern mirrors ops-queries.ts: each helper returns a small
// typed snapshot, non-throwing, non-blocking.
// ─────────────────────────────────────────────────────────────

import fs from 'fs'
import path from 'path'

// ── Run types ─────────────────────────────────────────────────

export type RunStatus =
  | 'complete'
  | 'in_progress'
  | 'pending_approval'
  | 'plan_only'
  | 'blocked'

export type OpportunityType = 'data_gap' | 'seo' | 'product' | 'qa' | 'release'

export type OverallRecommendation =
  | 'READY_TO_SHIP'
  | 'DO_NOT_SHIP'
  | 'PENDING_ENRICHMENT'
  | 'PENDING_APPROVAL'
  | 'NEEDS_VERIFICATION'

export interface AgentRunSummary {
  agent: string
  status: RunStatus
  verdict?: string     // QA verdict: PASS / FAIL / CONDITIONAL_PASS
  seoStatus?: string   // SEO proposal status: READY / ON_HOLD / BLOCKED
}

export interface GrowthOsRun {
  run_id: string
  trigger: string
  created_at: string
  status: RunStatus
  human_approval: 'approved' | 'rejected' | 'pending'
  overall_recommendation: string
  opportunity_type?: OpportunityType
  opportunity_title?: string
  qualifying_spots?: number
  agents: AgentRunSummary[]
}

// ── Task types ────────────────────────────────────────────────

export type LoopStage =
  | 'observe'
  | 'research'
  | 'enrich'
  | 'verify'
  | 're_research'
  | 'propose'
  | 'qa'
  | 'ship'

export type TaskOwner = 'script' | 'human' | 'agent'

// Effective status is computed from the dependency graph.
// 'done' is human-set in the JSON; all others are computed.
export type TaskEffectiveStatus =
  | 'ready'         // No unmet dependencies
  | 'blocked'       // Has unmet dependencies (all valid, just incomplete)
  | 'done'          // Human marked as done
  | 'config_error'  // One or more blocked_by IDs not found in the task file

export interface GrowthOsTask {
  id: string
  source_run_id: string
  title: string
  type: string
  owner: TaskOwner
  /** Status as stored in JSON — only 'done' is meaningful as input; rest are computed */
  status: string
  /** Computed at load time — authoritative for dashboard rendering */
  effective_status: TaskEffectiveStatus
  reason: string
  command?: string
  manual_instructions?: string[]
  expected_output: string
  completion_criteria: string[]
  next_run_trigger: string
  risk: 'low' | 'medium' | 'high'
  related_spots: Array<{ id: string; name: string }>
  blocked_by: string[]
  /** IDs in blocked_by that could not be resolved — triggers config_error */
  invalid_deps: string[]
  created_at: string
}

export interface QualityGate {
  required_spots: number
  qualifying_spots: number
  status: 'BLOCKED' | 'READY' | 'ON_HOLD'
  block_reason?: string
}

export interface TasksFile {
  source_run_id: string
  loop_stage: LoopStage
  quality_gate: QualityGate
  tasks: GrowthOsTask[]
}

export interface TasksSnapshot {
  files: TasksFile[]
  /** Total config_error tasks across all files — triggers dashboard warning */
  configErrorCount: number
  /** All config_error task IDs and their bad dep references for display */
  configErrors: Array<{ taskId: string; invalidDeps: string[] }>
}

export interface GrowthOsSnapshot {
  runs: GrowthOsRun[]
  totalRuns: number
  pendingApproval: number
  readyToShip: number
  blocked: number
  tasks: TasksSnapshot
  fetchedAt: string
}

// ── Helpers ───────────────────────────────────────────────────

const RUNS_DIR = path.join(process.cwd(), 'ai', 'runs')
const TASKS_DIR = path.join(process.cwd(), 'ai', 'tasks')

function safeReadJson(filePath: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

function parseRun(data: Record<string, unknown>): GrowthOsRun {
  // Extract agent summaries from the agents map
  const agentsRaw = (data.agents ?? {}) as Record<string, Record<string, unknown>>
  const agents: AgentRunSummary[] = Object.entries(agentsRaw).map(([key, agent]) => ({
    agent: key,
    status: (agent.status as RunStatus) ?? 'complete',
    verdict: (agent.verdict as string | undefined),
    seoStatus: (agent.proposal as Record<string, unknown> | undefined)?.status as string | undefined,
  }))

  // Extract opportunity title and type from research agent if present
  const research = agentsRaw.research as Record<string, unknown> | undefined
  const opportunity = research?.opportunity as Record<string, unknown> | undefined
  const seo = agentsRaw.seo as Record<string, unknown> | undefined
  const seoProposal = seo?.proposal as Record<string, unknown> | undefined

  return {
    run_id: (data.run_id as string) ?? 'unknown',
    trigger: (data.trigger as string) ?? '',
    created_at: (data.created_at as string) ?? '',
    status: (data.status as RunStatus) ?? 'complete',
    human_approval: (data.human_approval as GrowthOsRun['human_approval']) ?? 'pending',
    overall_recommendation: (data.overall_recommendation as string) ?? '',
    opportunity_type: (opportunity?.type as OpportunityType | undefined),
    opportunity_title: (opportunity?.title as string | undefined),
    qualifying_spots: (seoProposal?.qualifying_spots as number | undefined),
    agents,
  }
}

// ── Task validation ───────────────────────────────────────────

/**
 * Validates and enriches raw tasks from a task file.
 *
 * FAIL-SAFE: If any blocked_by ID does not exist in the task set,
 * the task is marked config_error — it is never silently unlocked.
 * Invalid dep IDs are recorded in invalid_deps for display.
 */
function validateAndEnrichTasks(
  rawTasks: Array<Record<string, unknown>>
): GrowthOsTask[] {
  // Build the set of all valid task IDs in this file
  const validIds = new Set(rawTasks.map((t) => t.id as string).filter(Boolean))

  return rawTasks.map((t) => {
    const id = (t.id as string) ?? 'unknown'
    const storedStatus = (t.status as string) ?? 'ready'
    const blockedBy = (t.blocked_by as string[] | undefined) ?? []

    // Identify any blocked_by references that don't exist in the task file
    const invalidDeps = blockedBy.filter((depId) => !validIds.has(depId))
    const hasInvalidDeps = invalidDeps.length > 0

    // Find dependencies that are not yet done
    const pendingDeps = blockedBy.filter((depId) => {
      if (!validIds.has(depId)) return false // invalid — handled separately
      const dep = rawTasks.find((d) => d.id === depId)
      return dep?.status !== 'done'
    })

    let effective_status: TaskEffectiveStatus
    if (hasInvalidDeps) {
      // FAIL-SAFE: broken dep graph → config_error, never silently unlock
      effective_status = 'config_error'
    } else if (storedStatus === 'done') {
      effective_status = 'done'
    } else if (pendingDeps.length > 0) {
      effective_status = 'blocked'
    } else {
      effective_status = 'ready'
    }

    return {
      id,
      source_run_id: (t.source_run_id as string) ?? '',
      title: (t.title as string) ?? '',
      type: (t.type as string) ?? '',
      owner: (t.owner as TaskOwner) ?? 'human',
      status: storedStatus,
      effective_status,
      reason: (t.reason as string) ?? '',
      command: t.command as string | undefined,
      manual_instructions: t.manual_instructions as string[] | undefined,
      expected_output: (t.expected_output as string) ?? '',
      completion_criteria: (t.completion_criteria as string[]) ?? [],
      next_run_trigger: (t.next_run_trigger as string) ?? '',
      risk: (t.risk as 'low' | 'medium' | 'high') ?? 'low',
      related_spots: (t.related_spots as Array<{ id: string; name: string }>) ?? [],
      blocked_by: blockedBy,
      invalid_deps: invalidDeps,
      created_at: (t.created_at as string) ?? '',
    }
  })
}

function parseTasksFile(data: Record<string, unknown>): TasksFile {
  const rawTasks = (data.tasks as Array<Record<string, unknown>> | undefined) ?? []
  const tasks = validateAndEnrichTasks(rawTasks)

  return {
    source_run_id: (data.source_run_id as string) ?? 'unknown',
    loop_stage: (data.loop_stage as LoopStage) ?? 'observe',
    quality_gate: (data.quality_gate as QualityGate) ?? {
      required_spots: 0,
      qualifying_spots: 0,
      status: 'BLOCKED',
    },
    tasks,
  }
}

// ── Main snapshots ────────────────────────────────────────────

async function loadRuns(): Promise<Pick<GrowthOsSnapshot, 'runs' | 'totalRuns' | 'pendingApproval' | 'readyToShip' | 'blocked'>> {
  const empty = { runs: [], totalRuns: 0, pendingApproval: 0, readyToShip: 0, blocked: 0 }

  let files: string[] = []
  try {
    files = fs
      .readdirSync(RUNS_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse() // newest first (alphabetical desc works because filenames are date-prefixed)
  } catch {
    return empty
  }

  const runs: GrowthOsRun[] = []
  for (const file of files) {
    const data = safeReadJson(path.join(RUNS_DIR, file))
    if (!data) continue
    runs.push(parseRun(data))
  }

  const pendingApproval = runs.filter((r) => r.human_approval === 'pending').length
  const readyToShip = runs.filter((r) =>
    r.overall_recommendation.includes('READY_TO_SHIP')
  ).length
  const blocked = runs.filter((r) =>
    r.overall_recommendation.includes('DO_NOT_SHIP') ||
    r.overall_recommendation.includes('BLOCKED')
  ).length

  return { runs, totalRuns: runs.length, pendingApproval, readyToShip, blocked }
}

async function loadTasks(): Promise<TasksSnapshot> {
  let files: string[] = []
  try {
    files = fs
      .readdirSync(TASKS_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse()
  } catch {
    return { files: [], configErrorCount: 0, configErrors: [] }
  }

  const taskFiles: TasksFile[] = []
  for (const file of files) {
    const data = safeReadJson(path.join(TASKS_DIR, file))
    if (!data) continue
    taskFiles.push(parseTasksFile(data))
  }

  const configErrors: Array<{ taskId: string; invalidDeps: string[] }> = []
  for (const tf of taskFiles) {
    for (const task of tf.tasks) {
      if (task.effective_status === 'config_error') {
        configErrors.push({ taskId: task.id, invalidDeps: task.invalid_deps })
      }
    }
  }

  return {
    files: taskFiles,
    configErrorCount: configErrors.length,
    configErrors,
  }
}

export async function getGrowthOsSnapshot(): Promise<GrowthOsSnapshot> {
  const [runsData, tasks] = await Promise.all([loadRuns(), loadTasks()])

  return {
    ...runsData,
    tasks,
    fetchedAt: new Date().toISOString(),
  }
}
