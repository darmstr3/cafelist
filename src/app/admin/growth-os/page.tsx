// ─────────────────────────────────────────────────────────────
// /admin/growth-os — CafeList Growth OS Dashboard
//
// Shows the product improvement loop: opportunities found,
// agent run details, proposals, QA status, and ship log.
// Also shows the Unblock Queue: loop position, quality gate,
// and tasks grouped by effective status (ready / blocked / done).
//
// Reads from /ai/runs/*.json and /ai/tasks/*.json — no new DB.
// Gated by the existing Basic Auth middleware on /admin/*.
// ─────────────────────────────────────────────────────────────

import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import {
  ChevronLeft,
  Clock,
  RefreshCw,
  Search,
  Database,
  FileText,
  Wrench,
  ShieldCheck,
  Rocket,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  CircleDashed,
  ArrowRight,
  Terminal,
  User,
  Bot,
  Lock,
  AlertCircle,
} from 'lucide-react'
import {
  getGrowthOsSnapshot,
  type GrowthOsRun,
  type AgentRunSummary,
  type GrowthOsTask,
  type TasksFile,
  type TaskEffectiveStatus,
  type LoopStage,
  type QualityGate,
} from '@/lib/admin/growth-os-queries'
import { CopyButton } from './CopyButton'
import { getCurrentUser } from '@/lib/supabase-server'

export const metadata = {
  title: 'Growth OS — Cafelist',
  description:
    'CafeList Growth OS: product improvement loop — opportunities, agent runs, proposals, QA, and ship log.',
}

export const dynamic = 'force-dynamic'

// ── Access control ────────────────────────────────────────────

/**
 * Returns the set of emails allowed to view this dashboard.
 * Read from GROWTH_OS_ALLOWED_EMAILS (comma-separated).
 * Returns null if the env var is missing — callers must fail closed.
 */
function getAllowedEmails(): Set<string> | null {
  const raw = process.env.GROWTH_OS_ALLOWED_EMAILS
  if (!raw?.trim()) return null
  return new Set(raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))
}

// ── Server action ─────────────────────────────────────────────

async function refreshAction(): Promise<void> {
  'use server'
  revalidatePath('/admin/growth-os')
}

// ── Agent display config ──────────────────────────────────────

const AGENT_META: Record<string, { label: string; icon: React.ReactNode }> = {
  research:         { label: 'Research',       icon: <Search size={13} /> },
  data_enrichment:  { label: 'Enrichment',     icon: <Database size={13} /> },
  seo:              { label: 'SEO',            icon: <FileText size={13} /> },
  product:          { label: 'Product',        icon: <Wrench size={13} /> },
  engineering:      { label: 'Engineering',    icon: <Wrench size={13} /> },
  qa:               { label: 'QA',             icon: <ShieldCheck size={13} /> },
  release:          { label: 'Release',        icon: <Rocket size={13} /> },
}

// ── Loop stage config ─────────────────────────────────────────

const LOOP_STAGES: LoopStage[] = [
  'observe', 'research', 'enrich', 'verify', 're_research', 'propose', 'qa', 'ship',
]

const STAGE_LABELS: Record<LoopStage, string> = {
  observe:     'Observe',
  research:    'Research',
  enrich:      'Enrich',
  verify:      'Verify',
  re_research: 'Re-research',
  propose:     'Propose',
  qa:          'QA',
  ship:        'Ship',
}

// ── Page ─────────────────────────────────────────────────────

export default async function GrowthOsPage() {
  // ── Auth gate ──────────────────────────────────────────────
  // Layer 2: Basic Auth (middleware) already blocked unauthenticated browsers.
  // This layer additionally requires a signed-in Supabase account whose email
  // is in GROWTH_OS_ALLOWED_EMAILS. Fail closed if the env var is absent.
  const allowedEmails = getAllowedEmails()
  if (!allowedEmails) {
    return <AccessDenied reason="GROWTH_OS_ALLOWED_EMAILS is not configured on this server." />
  }

  const user = await getCurrentUser()
  if (!user || !allowedEmails.has((user.email ?? '').toLowerCase())) {
    return <AccessDenied reason={user ? `${user.email} is not on the allowlist.` : undefined} />
  }
  // ── End auth gate ──────────────────────────────────────────

  const snap = await getGrowthOsSnapshot()

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
      <TopBar fetchedAt={snap.fetchedAt} />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* TODO: remove this marker once confirmed working in prod */}
        <div
          className="text-[11px] px-3 py-1.5 rounded font-mono"
          style={{ backgroundColor: 'rgba(47,125,79,0.10)', color: 'var(--yes)', display: 'inline-flex' }}
        >
          ✓ Growth OS dashboard loaded · signed in as {user.email}
        </div>

        <header className="space-y-2">
          <h1
            className="text-2xl sm:text-3xl font-semibold tracking-tight"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-fraunces)' }}
          >
            Growth OS
          </h1>
          <p className="text-sm leading-relaxed max-w-2xl" style={{ color: 'var(--text-secondary)' }}>
            Semi-autonomous product improvement loop for CafeList.
            Observe → Research → Enrich → Propose → QA → Approve → Ship → Log → Repeat.
          </p>
        </header>

        {/* Overview strip */}
        <OverviewStrip snap={snap} />

        {/* Config error warning — shown whenever any task file has broken deps */}
        {snap.tasks.configErrorCount > 0 && (
          <ConfigErrorBanner errors={snap.tasks.configErrors} />
        )}

        {/* Unblock Queue */}
        {snap.tasks.files.length > 0 && (
          <section>
            <SectionHeading>Unblock queue</SectionHeading>
            <div className="space-y-6">
              {snap.tasks.files.map((tf) => (
                <UnblockQueueCard key={tf.source_run_id} tasksFile={tf} />
              ))}
            </div>
          </section>
        )}

        {/* Run list */}
        <section>
          <SectionHeading>Opportunity runs</SectionHeading>
          {snap.runs.length === 0 ? (
            <EmptyState
              message="No runs yet. Add a JSON file to /ai/runs/ to get started."
              detail="See /ai/prompts/research-agent.md for the output format."
            />
          ) : (
            <div className="space-y-4">
              {snap.runs.map((run) => (
                <RunCard key={run.run_id} run={run} />
              ))}
            </div>
          )}
        </section>

        {/* System docs */}
        <DocsFooter />
      </div>
    </div>
  )
}

// ── Access denied ─────────────────────────────────────────────

function AccessDenied({ reason }: { reason?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--background)' }}>
      <div
        className="max-w-sm w-full rounded-lg border p-8 text-center space-y-4"
        style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface-1)' }}
      >
        <div className="text-3xl">🔒</div>
        <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
          Access denied
        </h1>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {reason
            ? reason
            : 'You must be signed in with an authorised account to view this dashboard.'}
        </p>
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--accent)', color: 'white' }}
        >
          Sign in
        </Link>
        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          After signing in, return to{' '}
          <code
            className="px-1 py-0.5 rounded text-[10px]"
            style={{ backgroundColor: 'rgba(0,0,0,0.06)' }}
          >
            /admin/growth-os
          </code>
        </p>
      </div>
    </div>
  )
}

// ── Top bar ──────────────────────────────────────────────────

function TopBar({ fetchedAt }: { fetchedAt: string }) {
  return (
    <div
      className="sticky top-0 z-20 border-b"
      style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border-subtle)' }}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-xs font-medium transition-opacity hover:opacity-70"
          style={{ color: 'var(--text-muted)' }}
        >
          <ChevronLeft size={13} />
          Back to admin
        </Link>

        <div className="ml-auto flex items-center gap-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          <span className="inline-flex items-center gap-1">
            <Clock size={12} />
            {formatRelative(fetchedAt)}
          </span>
          <form action={refreshAction}>
            <button
              type="submit"
              className="inline-flex items-center gap-1 px-2 py-1 rounded border transition-opacity hover:opacity-80"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            >
              <RefreshCw size={11} />
              Refresh
            </button>
          </form>
        </div>

        <span
          className="ml-3 wordmark text-[15px] flex items-center gap-2"
          style={{ color: 'var(--text-primary)' }}
        >
          <span>Cafelist</span>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide"
            style={{ backgroundColor: 'var(--accent-glow)', color: 'var(--accent)' }}
          >
            Growth OS
          </span>
        </span>
      </div>
    </div>
  )
}

// ── Overview strip ────────────────────────────────────────────

function OverviewStrip({ snap }: { snap: Awaited<ReturnType<typeof getGrowthOsSnapshot>> }) {
  const items = [
    { label: 'Total runs', value: snap.totalRuns },
    { label: 'Pending approval', value: snap.pendingApproval },
    { label: 'Ready to ship', value: snap.readyToShip },
    { label: 'Blocked', value: snap.blocked },
  ]

  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg border p-4"
      style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface-1)' }}
    >
      {items.map(({ label, value }) => (
        <div key={label}>
          <div
            className="text-[10px] uppercase tracking-wide font-medium"
            style={{ color: 'var(--text-muted)' }}
          >
            {label}
          </div>
          <div
            className="text-2xl font-semibold tabular-nums mt-0.5"
            style={{ color: 'var(--text-primary)' }}
          >
            {value}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Config error banner ───────────────────────────────────────

function ConfigErrorBanner({
  errors,
}: {
  errors: Array<{ taskId: string; invalidDeps: string[] }>
}) {
  return (
    <div
      className="rounded-lg border p-4 text-[12px] space-y-2"
      style={{
        borderColor: 'var(--no)',
        backgroundColor: 'rgba(168,57,47,0.06)',
        color: 'var(--text-secondary)',
      }}
    >
      <div className="flex items-center gap-2 font-semibold" style={{ color: 'var(--no)' }}>
        <AlertCircle size={14} />
        Dependency config errors — {errors.length} task{errors.length !== 1 ? 's' : ''} affected
      </div>
      <p style={{ color: 'var(--text-muted)' }}>
        The following tasks reference blocked_by IDs that don&apos;t exist in their task file.
        They are held as <strong>config_error</strong> and will not be shown as ready.
        Fix the task JSON to resolve.
      </p>
      <ul className="space-y-1 mt-1">
        {errors.map(({ taskId, invalidDeps }) => (
          <li key={taskId} className="font-mono">
            <code
              className="px-1 py-0.5 rounded text-[11px]"
              style={{ backgroundColor: 'rgba(168,57,47,0.10)', color: 'var(--no)' }}
            >
              {taskId}
            </code>
            <span style={{ color: 'var(--text-muted)' }}>
              {' '}→ unknown dep{invalidDeps.length !== 1 ? 's' : ''}:{' '}
            </span>
            {invalidDeps.map((d, i) => (
              <span key={d}>
                <code
                  className="px-1 py-0.5 rounded text-[11px]"
                  style={{ backgroundColor: 'rgba(0,0,0,0.06)' }}
                >
                  {d}
                </code>
                {i < invalidDeps.length - 1 ? ', ' : ''}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Unblock queue card ────────────────────────────────────────

function UnblockQueueCard({ tasksFile }: { tasksFile: TasksFile }) {
  const readyTasks = tasksFile.tasks.filter((t) => t.effective_status === 'ready')
  const blockedTasks = tasksFile.tasks.filter((t) => t.effective_status === 'blocked')
  const doneTasks = tasksFile.tasks.filter((t) => t.effective_status === 'done')
  const errorTasks = tasksFile.tasks.filter((t) => t.effective_status === 'config_error')

  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface-1)' }}
    >
      {/* Card header: loop position + quality gate */}
      <div
        className="px-5 py-4 border-b"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-xs font-mono"
                style={{ color: 'var(--text-muted)' }}
              >
                {tasksFile.source_run_id}
              </span>
            </div>
            <LoopPositionIndicator stage={tasksFile.loop_stage} />
          </div>
          <QualityGateStatus gate={tasksFile.quality_gate} />
        </div>
      </div>

      {/* Task groups */}
      <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
        {readyTasks.length > 0 && (
          <TaskGroup
            label="Ready now"
            labelColor="var(--yes)"
            tasks={readyTasks}
            emptyMessage={null}
          />
        )}
        {blockedTasks.length > 0 && (
          <TaskGroup
            label="Waiting on completions"
            labelColor="var(--text-muted)"
            tasks={blockedTasks}
            emptyMessage={null}
          />
        )}
        {errorTasks.length > 0 && (
          <TaskGroup
            label="Config errors"
            labelColor="var(--no)"
            tasks={errorTasks}
            emptyMessage={null}
          />
        )}
        {doneTasks.length > 0 && (
          <TaskGroup
            label="Done"
            labelColor="var(--text-muted)"
            tasks={doneTasks}
            emptyMessage={null}
          />
        )}
        {tasksFile.tasks.length === 0 && (
          <div className="px-5 py-6 text-center text-[12px]" style={{ color: 'var(--text-muted)' }}>
            No tasks in this file.
          </div>
        )}
      </div>
    </div>
  )
}

// ── Loop position indicator ───────────────────────────────────

function LoopPositionIndicator({ stage }: { stage: LoopStage }) {
  const currentIndex = LOOP_STAGES.indexOf(stage)

  return (
    <div className="flex items-center gap-0 flex-wrap">
      {LOOP_STAGES.map((s, i) => {
        const isCurrent = s === stage
        const isDone = i < currentIndex

        return (
          <span key={s} className="flex items-center">
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded"
              style={{
                backgroundColor: isCurrent
                  ? 'var(--accent-glow)'
                  : isDone
                  ? 'rgba(47,125,79,0.08)'
                  : 'transparent',
                color: isCurrent
                  ? 'var(--accent)'
                  : isDone
                  ? 'var(--yes)'
                  : 'var(--text-muted)',
                fontWeight: isCurrent ? 600 : 400,
              }}
            >
              {STAGE_LABELS[s]}
            </span>
            {i < LOOP_STAGES.length - 1 && (
              <span style={{ color: 'var(--border-subtle)', fontSize: '10px', margin: '0 1px' }}>
                →
              </span>
            )}
          </span>
        )
      })}
    </div>
  )
}

// ── Quality gate status ───────────────────────────────────────

function QualityGateStatus({ gate }: { gate: QualityGate }) {
  const isBlocked = gate.status === 'BLOCKED'
  const isReady = gate.status === 'READY'

  return (
    <div
      className="shrink-0 rounded-lg border px-3 py-2 text-[11px] min-w-[140px]"
      style={{
        borderColor: isBlocked
          ? 'rgba(168,57,47,0.3)'
          : isReady
          ? 'rgba(47,125,79,0.3)'
          : 'rgba(198,133,18,0.3)',
        backgroundColor: isBlocked
          ? 'rgba(168,57,47,0.05)'
          : isReady
          ? 'rgba(47,125,79,0.05)'
          : 'rgba(198,133,18,0.05)',
      }}
    >
      <div
        className="font-semibold uppercase tracking-wide text-[9px] mb-1"
        style={{
          color: isBlocked ? 'var(--no)' : isReady ? 'var(--yes)' : 'var(--kinda)',
        }}
      >
        SEO quality gate
      </div>
      <div className="flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
        <span className="tabular-nums font-semibold">
          {gate.qualifying_spots}
        </span>
        <span style={{ color: 'var(--text-muted)' }}>
          / {gate.required_spots} spots
        </span>
      </div>
      {gate.block_reason && (
        <p
          className="mt-1 leading-snug"
          style={{ color: 'var(--text-muted)', maxWidth: '200px' }}
        >
          {gate.block_reason.length > 80
            ? gate.block_reason.slice(0, 77) + '…'
            : gate.block_reason}
        </p>
      )}
    </div>
  )
}

// ── Task group ────────────────────────────────────────────────

function TaskGroup({
  label,
  labelColor,
  tasks,
  emptyMessage,
}: {
  label: string
  labelColor: string
  tasks: GrowthOsTask[]
  emptyMessage: string | null
}) {
  if (tasks.length === 0 && !emptyMessage) return null

  return (
    <div className="px-5 py-4">
      <div
        className="text-[10px] uppercase tracking-wide font-semibold mb-3"
        style={{ color: labelColor }}
      >
        {label} {tasks.length > 0 ? `(${tasks.length})` : ''}
      </div>
      {tasks.length === 0 && emptyMessage ? (
        <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {emptyMessage}
        </p>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Task row ──────────────────────────────────────────────────

function TaskRow({ task }: { task: GrowthOsTask }) {
  const s = taskStatusStyle(task.effective_status)

  return (
    <div
      className="rounded border p-3 space-y-2"
      style={{
        borderColor:
          task.effective_status === 'config_error'
            ? 'rgba(168,57,47,0.3)'
            : task.effective_status === 'done'
            ? 'rgba(47,125,79,0.15)'
            : 'var(--border-subtle)',
        backgroundColor:
          task.effective_status === 'done'
            ? 'rgba(47,125,79,0.03)'
            : 'transparent',
        opacity: task.effective_status === 'done' ? 0.7 : 1,
      }}
    >
      {/* Row header */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-[11px] font-medium leading-snug"
              style={{ color: 'var(--text-primary)' }}
            >
              {task.title}
            </span>
            <TaskStatusPill status={task.effective_status} />
            <OwnerPill owner={task.owner} />
          </div>
          <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            {task.reason}
          </p>
        </div>
      </div>

      {/* Command (for script tasks) */}
      {task.command && task.effective_status !== 'done' && (
        <div
          className="rounded px-2.5 py-1.5 space-y-1"
          style={{ backgroundColor: 'rgba(0,0,0,0.04)' }}
        >
          <div className="flex items-center gap-1 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
            <span>cd ~/Developer/Coffee List</span>
          </div>
          <div className="flex items-center gap-2">
            <Terminal size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <code
              className="flex-1 text-[11px] font-mono truncate"
              style={{ color: 'var(--text-secondary)' }}
            >
              {task.command}
            </code>
            <CopyButton text={task.command} />
          </div>
        </div>
      )}

      {/* Manual instructions (first step shown, collapsed) */}
      {task.manual_instructions && task.manual_instructions.length > 0 && task.effective_status !== 'done' && (
        <div
          className="text-[11px] rounded px-2.5 py-1.5 space-y-1"
          style={{ backgroundColor: 'rgba(0,0,0,0.04)', color: 'var(--text-muted)' }}
        >
          <div className="flex items-center gap-1.5 font-medium" style={{ color: 'var(--text-secondary)' }}>
            <User size={10} />
            Manual step{task.manual_instructions.length > 1 ? 's' : ''}
          </div>
          <p className="leading-relaxed">{task.manual_instructions[0]}</p>
          {task.manual_instructions.length > 1 && (
            <p style={{ color: 'var(--text-muted)' }}>
              + {task.manual_instructions.length - 1} more step{task.manual_instructions.length > 2 ? 's' : ''} in{' '}
              <code
                className="px-1 py-0.5 rounded text-[10px]"
                style={{ backgroundColor: 'rgba(0,0,0,0.06)' }}
              >
                /ai/tasks/
              </code>
            </p>
          )}
        </div>
      )}

      {/* Blocked-by list */}
      {task.effective_status === 'blocked' && task.blocked_by.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap text-[10px]" style={{ color: 'var(--text-muted)' }}>
          <Lock size={10} />
          <span>Waiting on:</span>
          {task.blocked_by.map((dep) => (
            <code
              key={dep}
              className="px-1 py-0.5 rounded"
              style={{ backgroundColor: 'rgba(0,0,0,0.06)', color: 'var(--text-secondary)' }}
            >
              {dep}
            </code>
          ))}
        </div>
      )}

      {/* Config error details */}
      {task.effective_status === 'config_error' && (
        <div className="flex items-start gap-1.5 text-[10px]" style={{ color: 'var(--no)' }}>
          <AlertCircle size={10} style={{ marginTop: '1px', flexShrink: 0 }} />
          <span>
            Unknown dep IDs:{' '}
            {task.invalid_deps.map((d, i) => (
              <span key={d}>
                <code
                  className="px-1 py-0.5 rounded"
                  style={{ backgroundColor: 'rgba(168,57,47,0.10)' }}
                >
                  {d}
                </code>
                {i < task.invalid_deps.length - 1 ? ', ' : ''}
              </span>
            ))}
            {' '}— fix in task JSON, then refresh.
          </span>
        </div>
      )}
    </div>
  )
}

// ── Task status pill ──────────────────────────────────────────

function TaskStatusPill({ status }: { status: TaskEffectiveStatus }) {
  const meta = {
    ready:        { label: 'Ready',        bg: 'rgba(47,125,79,0.12)',   color: 'var(--yes)' },
    blocked:      { label: 'Blocked',      bg: 'rgba(120,120,120,0.10)', color: 'var(--text-muted)' },
    done:         { label: 'Done',         bg: 'rgba(47,125,79,0.10)',   color: 'var(--yes)' },
    config_error: { label: 'Config error', bg: 'rgba(168,57,47,0.12)',   color: 'var(--no)' },
  }[status] ?? { label: status, bg: 'rgba(120,120,120,0.10)', color: 'var(--text-muted)' }

  return (
    <span
      className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full"
      style={{ backgroundColor: meta.bg, color: meta.color }}
    >
      {meta.label}
    </span>
  )
}

// ── Owner pill ────────────────────────────────────────────────

function OwnerPill({ owner }: { owner: string }) {
  const icon =
    owner === 'script' ? <Terminal size={9} /> :
    owner === 'agent'  ? <Bot size={9} /> :
                         <User size={9} />

  return (
    <span
      className="inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full"
      style={{ backgroundColor: 'rgba(120,120,120,0.08)', color: 'var(--text-muted)' }}
    >
      {icon}
      {owner}
    </span>
  )
}

// ── Run card ──────────────────────────────────────────────────

function RunCard({ run }: { run: GrowthOsRun }) {
  const approvalStyle = approvalMeta(run.human_approval)
  const recommendStyle = recommendMeta(run.overall_recommendation)

  return (
    <section
      className="rounded-lg border p-5 space-y-4"
      style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface-1)' }}
    >
      {/* Header row */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-xs font-mono"
              style={{ color: 'var(--text-muted)' }}
            >
              {run.run_id}
            </span>
            {run.opportunity_type ? (
              <TypePill type={run.opportunity_type} />
            ) : null}
          </div>
          {run.opportunity_title ? (
            <p
              className="mt-1 text-sm font-medium leading-snug"
              style={{ color: 'var(--text-primary)' }}
            >
              {run.opportunity_title}
            </p>
          ) : (
            <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
              {run.trigger}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span
            className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full"
            style={{ backgroundColor: approvalStyle.bg, color: approvalStyle.color }}
          >
            {approvalStyle.label}
          </span>
          <span
            className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full"
            style={{ backgroundColor: recommendStyle.bg, color: recommendStyle.color }}
          >
            {recommendStyle.label}
          </span>
        </div>
      </div>

      {/* Agent pipeline */}
      <div>
        <div
          className="text-[10px] uppercase tracking-wide font-medium mb-2"
          style={{ color: 'var(--text-muted)' }}
        >
          Agent pipeline
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {run.agents.map((agent, i) => (
            <span key={agent.agent} className="flex items-center gap-1">
              <AgentPill agent={agent} />
              {i < run.agents.length - 1 ? (
                <ArrowRight size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              ) : null}
            </span>
          ))}
        </div>
      </div>

      {/* Key signals */}
      <div className="flex items-center gap-4 flex-wrap text-[11px]" style={{ color: 'var(--text-muted)' }}>
        <span>
          <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>Qualifying spots:</span>{' '}
          {run.qualifying_spots != null ? run.qualifying_spots : '—'}
        </span>
        <span>
          <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>Created:</span>{' '}
          {run.created_at ? formatDate(run.created_at) : '—'}
        </span>
      </div>

      {/* Next actions if pending */}
      {run.human_approval === 'pending' && (
        <div
          className="text-[11px] rounded p-3 leading-relaxed"
          style={{
            backgroundColor: 'rgba(198,133,18,0.06)',
            borderLeft: '3px solid var(--kinda)',
            color: 'var(--text-secondary)',
          }}
        >
          <span className="font-medium" style={{ color: 'var(--kinda)' }}>Pending your review.</span>{' '}
          See{' '}
          <code className="px-1 py-0.5 rounded text-[10px]" style={{ backgroundColor: 'rgba(0,0,0,0.06)' }}>
            /ai/runs/{run.run_id}.json
          </code>{' '}
          for the full agent output, recommended next actions, and the unblock checklist.
        </div>
      )}
    </section>
  )
}

// ── Agent pill ────────────────────────────────────────────────

function AgentPill({ agent }: { agent: AgentRunSummary }) {
  const meta = AGENT_META[agent.agent] ?? { label: agent.agent, icon: null }
  const s = agentPillStyle(agent)

  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full"
      style={{ backgroundColor: s.bg, color: s.color }}
    >
      {meta.icon}
      {meta.label}
      {agentStatusIcon(agent)}
    </span>
  )
}

function agentPillStyle(agent: AgentRunSummary): { bg: string; color: string } {
  if (agent.verdict === 'FAIL') return { bg: 'rgba(168,57,47,0.12)', color: 'var(--no)' }
  if (agent.seoStatus === 'BLOCKED') return { bg: 'rgba(168,57,47,0.12)', color: 'var(--no)' }
  if (agent.seoStatus === 'ON_HOLD') return { bg: 'rgba(198,133,18,0.12)', color: 'var(--kinda)' }
  if (agent.status === 'plan_only') return { bg: 'rgba(120,120,120,0.10)', color: 'var(--text-muted)' }
  if (agent.status === 'pending_approval') return { bg: 'rgba(198,133,18,0.12)', color: 'var(--kinda)' }
  return { bg: 'rgba(47,125,79,0.10)', color: 'var(--yes)' }
}

function agentStatusIcon(agent: AgentRunSummary): React.ReactNode {
  if (agent.verdict === 'PASS') return <CheckCircle2 size={10} />
  if (agent.verdict === 'FAIL') return <XCircle size={10} />
  if (agent.seoStatus === 'BLOCKED') return <XCircle size={10} />
  if (agent.status === 'pending_approval') return <AlertTriangle size={10} />
  if (agent.status === 'plan_only') return <CircleDashed size={10} />
  return null
}

// ── Type pill ─────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  data_gap: 'Data gap',
  seo: 'SEO',
  product: 'Product',
  qa: 'QA',
  release: 'Release',
}

function TypePill({ type }: { type: string }) {
  return (
    <span
      className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
      style={{
        backgroundColor: 'var(--accent-glow)',
        color: 'var(--accent)',
      }}
    >
      {TYPE_LABELS[type] ?? type}
    </span>
  )
}

// ── Task status style helper ──────────────────────────────────

function taskStatusStyle(status: TaskEffectiveStatus) {
  switch (status) {
    case 'ready':        return { bg: 'rgba(47,125,79,0.12)',   color: 'var(--yes)' }
    case 'done':         return { bg: 'rgba(47,125,79,0.08)',   color: 'var(--yes)' }
    case 'config_error': return { bg: 'rgba(168,57,47,0.12)',   color: 'var(--no)' }
    default:             return { bg: 'rgba(120,120,120,0.10)', color: 'var(--text-muted)' }
  }
}

// ── Approval meta ─────────────────────────────────────────────

function approvalMeta(approval: GrowthOsRun['human_approval']): {
  label: string; bg: string; color: string
} {
  switch (approval) {
    case 'approved':
      return { label: 'Approved', bg: 'rgba(47,125,79,0.12)', color: 'var(--yes)' }
    case 'rejected':
      return { label: 'Rejected', bg: 'rgba(168,57,47,0.12)', color: 'var(--no)' }
    default:
      return { label: 'Pending review', bg: 'rgba(198,133,18,0.12)', color: 'var(--kinda)' }
  }
}

function recommendMeta(rec: string): { label: string; bg: string; color: string } {
  if (rec.includes('READY_TO_SHIP')) {
    return { label: 'Ready to ship', bg: 'rgba(47,125,79,0.12)', color: 'var(--yes)' }
  }
  if (rec.includes('DO_NOT_SHIP') || rec.includes('BLOCKED')) {
    return { label: 'Blocked', bg: 'rgba(168,57,47,0.12)', color: 'var(--no)' }
  }
  if (rec.includes('PENDING')) {
    return { label: 'Pending action', bg: 'rgba(198,133,18,0.12)', color: 'var(--kinda)' }
  }
  return { label: rec.replace(/_/g, ' ').toLowerCase(), bg: 'rgba(120,120,120,0.10)', color: 'var(--text-muted)' }
}

// ── Section heading ───────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-sm font-semibold mb-3 uppercase tracking-wide"
      style={{ color: 'var(--text-muted)' }}
    >
      {children}
    </h2>
  )
}

// ── Empty state ───────────────────────────────────────────────

function EmptyState({ message, detail }: { message: string; detail?: string }) {
  return (
    <div
      className="rounded-lg border p-8 text-center"
      style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface-1)' }}
    >
      <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
        {message}
      </p>
      {detail ? (
        <p className="mt-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {detail}
        </p>
      ) : null}
    </div>
  )
}

// ── Docs footer ───────────────────────────────────────────────

function DocsFooter() {
  const docs = [
    { label: 'Product Principles', path: '/ai/PRODUCT_PRINCIPLES.md' },
    { label: 'Agent Roles', path: '/ai/AGENTS.md' },
    { label: 'Data Schema', path: '/ai/DATA_SCHEMA.md' },
    { label: 'SEO Rules', path: '/ai/SEO_RULES.md' },
    { label: 'Quality Bar', path: '/ai/QUALITY_BAR.md' },
    { label: 'Do Not Do', path: '/ai/DO_NOT_DO.md' },
  ]

  return (
    <section
      className="rounded-lg border p-4 text-[12px]"
      style={{
        borderColor: 'var(--border-subtle)',
        backgroundColor: 'var(--surface-1)',
        color: 'var(--text-secondary)',
      }}
    >
      <div className="font-medium mb-2 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
        <CheckCircle2 size={13} />
        System docs
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {docs.map(({ label, path }) => (
          <span key={path}>
            {label} →{' '}
            <code className="px-1 py-0.5 rounded text-[11px]" style={{ backgroundColor: 'rgba(0,0,0,0.05)' }}>
              {path}
            </code>
          </span>
        ))}
      </div>
      <p className="mt-3" style={{ color: 'var(--text-muted)' }}>
        Agent prompt templates live in{' '}
        <code className="px-1 py-0.5 rounded text-[11px]" style={{ backgroundColor: 'rgba(0,0,0,0.05)' }}>
          /ai/prompts/
        </code>
        . Run outputs are saved to{' '}
        <code className="px-1 py-0.5 rounded text-[11px]" style={{ backgroundColor: 'rgba(0,0,0,0.05)' }}>
          /ai/runs/
        </code>
        . Task files live in{' '}
        <code className="px-1 py-0.5 rounded text-[11px]" style={{ backgroundColor: 'rgba(0,0,0,0.05)' }}>
          /ai/tasks/
        </code>
        . The Growth OS Ship Log is at{' '}
        <code className="px-1 py-0.5 rounded text-[11px]" style={{ backgroundColor: 'rgba(0,0,0,0.05)' }}>
          /ai/SHIP_LOG.md
        </code>
        .
      </p>
    </section>
  )
}

// ── Utilities ─────────────────────────────────────────────────

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diff = Math.max(0, now - then)
  const min = Math.round(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 14) return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  } catch {
    return iso
  }
}
