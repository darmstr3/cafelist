// ─────────────────────────────────────────────────────────────
// /admin/ops — Agent Operations dashboard for cafelist.
//
// Single page that aggregates every cafelist agent: Scout, Curator,
// Coverage Gap, Prompt Optimizer, /labs Eval. Reads directly from
// Supabase (service-role) so there's no client-side fetching.
//
// One place to: see whether each agent is alive, when it last ran,
// what it produced, and trigger a manual run. Goal is to stop having
// to hunt across Cowork chats and Vercel logs to answer "is X working?"
// ─────────────────────────────────────────────────────────────

import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Compass,
  Sparkles,
  Telescope,
  Wand2,
  Beaker,
  RefreshCw,
  Clock,
  Play,
} from 'lucide-react'
import {
  getOpsSnapshot,
  type ScoutSnapshot,
  type CuratorSnapshot,
  type CoverageGapSnapshot,
  type OptimizerSnapshot,
  type EvalSnapshot,
} from '@/lib/admin/ops-queries'

export const metadata = {
  title: 'Agent Ops — Cafelist',
  description:
    'Single-page operations view for every cafelist agent — Scout, Curator, Coverage Gap, Prompt Optimizer, /labs Eval. Status, recent activity, and manual triggers.',
}

export const dynamic = 'force-dynamic'

// ── Server actions ───────────────────────────────────────────

async function triggerScoutAction(): Promise<void> {
  'use server'

  // Calls /api/scout server-to-server with the operator secret so the
  // token never reaches the browser. Same Bearer the Cowork dispatcher
  // would use, but it never leaves Vercel.
  const secret = process.env.SCOUT_CRON_SECRET
  if (!secret) {
    console.error('triggerScoutAction: SCOUT_CRON_SECRET not set')
    return
  }

  const base =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    'http://localhost:3000'

  try {
    await fetch(`${base}/api/scout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      cache: 'no-store',
    })
  } catch (err) {
    console.error('triggerScoutAction: fetch failed', err)
  }

  revalidatePath('/admin/ops')
}

async function refreshAction(): Promise<void> {
  'use server'
  revalidatePath('/admin/ops')
}

// ── Page ─────────────────────────────────────────────────────

export default async function OpsPage() {
  const snap = await getOpsSnapshot()

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
      <TopBar fetchedAt={snap.fetchedAt} />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <header className="space-y-2">
          <h1
            className="text-2xl sm:text-3xl font-semibold tracking-tight"
            style={{
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-fraunces)',
            }}
          >
            Agent operations
          </h1>
          <p
            className="text-sm leading-relaxed max-w-3xl"
            style={{ color: 'var(--text-secondary)' }}
          >
            Live status for every agent powering cafelist — discovery,
            scoring, prompt search, and eval. Trigger a run, glance at
            cost, jump to detail views from one place.
          </p>
        </header>

        <div className="grid gap-4 lg:grid-cols-2">
          <ScoutCard snap={snap.scout} action={triggerScoutAction} />
          <CuratorCard snap={snap.curator} />
          <CoverageGapCard snap={snap.coverageGap} />
          <OptimizerCard snap={snap.optimizer} />
          <EvalCard snap={snap.eval} />
        </div>

        <RunbookFooter />
      </div>
    </div>
  )
}

// ── Top bar ──────────────────────────────────────────────────

function TopBar({ fetchedAt }: { fetchedAt: string }) {
  return (
    <div
      className="sticky top-0 z-20 border-b"
      style={{
        backgroundColor: 'var(--background)',
        borderColor: 'var(--border-subtle)',
      }}
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

        <div
          className="ml-auto flex items-center gap-3 text-[11px]"
          style={{ color: 'var(--text-muted)' }}
        >
          <span className="inline-flex items-center gap-1">
            <Clock size={12} />
            {formatRelative(fetchedAt)}
          </span>
          <form action={refreshAction}>
            <button
              type="submit"
              className="inline-flex items-center gap-1 px-2 py-1 rounded border transition-opacity hover:opacity-80"
              style={{
                borderColor: 'var(--border-subtle)',
                color: 'var(--text-primary)',
              }}
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
            style={{
              backgroundColor: 'var(--accent-glow)',
              color: 'var(--accent)',
            }}
          >
            Ops
          </span>
        </span>
      </div>
    </div>
  )
}

// ── Cards ────────────────────────────────────────────────────

function CardShell({
  icon,
  title,
  subtitle,
  status,
  children,
  footer,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  status: { kind: 'ok' | 'warn' | 'err' | 'idle'; label: string }
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <section
      className="rounded-lg border p-5 flex flex-col"
      style={{
        borderColor: 'var(--border-subtle)',
        backgroundColor: 'var(--surface-1)',
      }}
    >
      <div className="flex items-start gap-3 mb-4">
        <div
          className="w-9 h-9 rounded-md flex items-center justify-center shrink-0"
          style={{
            backgroundColor: 'var(--accent-glow)',
            color: 'var(--accent)',
          }}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="text-sm font-medium leading-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            {title}
          </div>
          <div
            className="text-[11px] mt-0.5"
            style={{ color: 'var(--text-muted)' }}
          >
            {subtitle}
          </div>
        </div>
        <StatusPill status={status} />
      </div>
      <div className="flex-1">{children}</div>
      {footer ? (
        <div
          className="mt-4 pt-3 border-t flex items-center gap-2 flex-wrap"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          {footer}
        </div>
      ) : null}
    </section>
  )
}

function StatusPill({
  status,
}: {
  status: { kind: 'ok' | 'warn' | 'err' | 'idle'; label: string }
}) {
  const styles: Record<typeof status.kind, { bg: string; color: string }> = {
    ok: { bg: 'rgba(47,125,79,0.12)', color: 'var(--yes)' },
    warn: { bg: 'rgba(198,133,18,0.12)', color: 'var(--kinda)' },
    err: { bg: 'rgba(168,57,47,0.12)', color: 'var(--no)' },
    idle: {
      bg: 'rgba(120,120,120,0.12)',
      color: 'var(--text-muted)',
    },
  }
  const s = styles[status.kind]
  return (
    <span
      className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full"
      style={{ backgroundColor: s.bg, color: s.color }}
    >
      {status.label}
    </span>
  )
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div>
      <div
        className="text-[10px] uppercase tracking-wide font-medium"
        style={{ color: 'var(--text-muted)' }}
      >
        {label}
      </div>
      <div
        className="text-base font-medium tabular-nums"
        style={{ color: 'var(--text-primary)' }}
      >
        {value}
      </div>
      {hint ? (
        <div
          className="text-[11px] mt-0.5"
          style={{ color: 'var(--text-muted)' }}
        >
          {hint}
        </div>
      ) : null}
    </div>
  )
}

// ── Scout card ───────────────────────────────────────────────

function ScoutCard({
  snap,
  action,
}: {
  snap: ScoutSnapshot
  action: () => Promise<void>
}) {
  const status = scoutStatus(snap)
  const capPct = (snap.spendLast24h / snap.capDaily) * 100

  return (
    <CardShell
      icon={<Telescope size={18} />}
      title="Scout"
      subtitle="Every 4h via Vercel Cron · discovers new spots"
      status={status}
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Metric
          label="Last run"
          value={snap.lastRun ? formatRelative(snap.lastRun.started_at) : '—'}
          hint={
            snap.lastRun?.city
              ? `${snap.lastRun.city}${snap.lastRun.neighborhood ? ' · ' + snap.lastRun.neighborhood : ''}`
              : undefined
          }
        />
        <Metric
          label="Inserted (last)"
          value={
            snap.lastRun
              ? `${snap.lastRun.candidates_inserted}/${snap.lastRun.candidates_examined}`
              : '—'
          }
        />
        <Metric
          label="24h spend"
          value={`$${snap.spendLast24h.toFixed(4)}`}
          hint={`${capPct.toFixed(0)}% of $${snap.capDaily.toFixed(2)} cap`}
        />
        <Metric
          label="Queue due"
          value={snap.queueDue != null ? String(snap.queueDue) : '—'}
          hint="cities ready to scout"
        />
      </div>

      {snap.lastRun?.error_message ? (
        <div
          className="mt-4 text-[12px] flex items-start gap-2 p-2 rounded"
          style={{
            backgroundColor: 'rgba(168,57,47,0.06)',
            color: 'var(--no)',
          }}
        >
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span className="break-words">{snap.lastRun.error_message}</span>
        </div>
      ) : null}

      {snap.recentRuns.length > 0 ? (
        <div className="mt-4">
          <div
            className="text-[10px] uppercase tracking-wide font-medium mb-1.5"
            style={{ color: 'var(--text-muted)' }}
          >
            Recent runs
          </div>
          <ul className="space-y-1">
            {snap.recentRuns.map((r) => (
              <li
                key={r.run_id}
                className="flex items-center gap-2 text-[11px] tabular-nums"
                style={{ color: 'var(--text-secondary)' }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{
                    backgroundColor: dotColor(r.status),
                  }}
                />
                <span style={{ color: 'var(--text-muted)' }}>
                  {formatRelative(r.started_at)}
                </span>
                <span>{r.status}</span>
                <span style={{ color: 'var(--text-muted)' }}>
                  · {r.city ?? '—'}
                </span>
                <span className="ml-auto">
                  +{r.candidates_inserted} · ${r.total_cost_usd.toFixed(4)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <form action={action}>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded border transition-opacity hover:opacity-80"
            style={{
              borderColor: 'var(--border-subtle)',
              backgroundColor: 'var(--accent)',
              color: 'var(--surface-1)',
            }}
          >
            <Play size={11} />
            Run scout now
          </button>
        </form>
        <Link
          href="/admin"
          className="text-xs font-medium px-3 py-1.5 rounded border inline-flex items-center transition-opacity hover:opacity-70"
          style={{
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-primary)',
          }}
        >
          Open admin
        </Link>
      </div>
    </CardShell>
  )
}

function scoutStatus(snap: ScoutSnapshot): {
  kind: 'ok' | 'warn' | 'err' | 'idle'
  label: string
} {
  if (!snap.lastRun) return { kind: 'idle', label: 'never run' }
  const s = snap.lastRun.status
  if (s === 'error') return { kind: 'err', label: 'errored' }
  if (s === 'cap_hit' || s === 'skipped' || s === 'partial')
    return { kind: 'warn', label: s.replace('_', ' ') }
  return { kind: 'ok', label: 'healthy' }
}

// ── Curator card ─────────────────────────────────────────────

function CuratorCard({ snap }: { snap: CuratorSnapshot }) {
  const status: { kind: 'ok' | 'warn' | 'err' | 'idle'; label: string } =
    snap.scoredAllTime === 0
      ? { kind: 'idle', label: 'never run' }
      : snap.viableShare != null && snap.viableShare < 0.2
        ? { kind: 'warn', label: 'low viable share' }
        : { kind: 'ok', label: 'healthy' }

  return (
    <CardShell
      icon={<Wand2 size={18} />}
      title="Curator"
      subtitle="Daily at 04:03 · scores workability 0–10"
      status={status}
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Metric
          label="Last scored"
          value={snap.lastScoredAt ? formatRelative(snap.lastScoredAt) : '—'}
        />
        <Metric
          label="Scored 24h"
          value={String(snap.scoredLast24h)}
          hint={`${snap.scoredAllTime} all-time`}
        />
        <Metric
          label="Pending rescore"
          value={String(snap.pendingRescore)}
          hint="null or >90d"
        />
        <Metric
          label="Viable share"
          value={
            snap.viableShare != null
              ? `${(snap.viableShare * 100).toFixed(0)}%`
              : '—'
          }
          hint={
            snap.avgWorkability != null
              ? `avg ${snap.avgWorkability.toFixed(2)}`
              : undefined
          }
        />
      </div>
      <div
        className="mt-4 text-[11px]"
        style={{ color: 'var(--text-muted)' }}
      >
        Manual run:{' '}
        <code className="px-1 py-0.5 rounded bg-black/5">
          npm run curate:workability
        </code>
      </div>
    </CardShell>
  )
}

// ── Coverage Gap card ────────────────────────────────────────

function CoverageGapCard({ snap }: { snap: CoverageGapSnapshot }) {
  const status: { kind: 'ok' | 'warn' | 'err' | 'idle'; label: string } =
    snap.queriesLast7d === 0
      ? { kind: 'idle', label: 'no queries 7d' }
      : { kind: 'ok', label: 'healthy' }

  const topModes = Object.entries(snap.failureModesLast7d)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)

  return (
    <CardShell
      icon={<Compass size={18} />}
      title="Coverage Gap"
      subtitle="Mondays at 07:00 · turns demand into Scout priorities"
      status={status}
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Metric label="Queries 7d" value={String(snap.queriesLast7d)} />
        <Metric
          label="Coverage-gap priorities"
          value={String(snap.activeCoverageGapPriorities)}
        />
        <Metric
          label="Last upsert"
          value={
            snap.lastUpsertAt ? formatRelative(snap.lastUpsertAt) : '—'
          }
        />
      </div>
      {topModes.length > 0 ? (
        <div className="mt-4">
          <div
            className="text-[10px] uppercase tracking-wide font-medium mb-1.5"
            style={{ color: 'var(--text-muted)' }}
          >
            Failure modes (7d)
          </div>
          <ul
            className="space-y-1 text-[11px]"
            style={{ color: 'var(--text-secondary)' }}
          >
            {topModes.map(([mode, count]) => (
              <li key={mode} className="flex items-center gap-2 tabular-nums">
                <span>{mode}</span>
                <span className="ml-auto">{count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div
        className="mt-4 text-[11px]"
        style={{ color: 'var(--text-muted)' }}
      >
        Manual run:{' '}
        <code className="px-1 py-0.5 rounded bg-black/5">
          npm run coverage-gap
        </code>
      </div>
    </CardShell>
  )
}

// ── Optimizer card ───────────────────────────────────────────

function OptimizerCard({ snap }: { snap: OptimizerSnapshot }) {
  const last = snap.lastRound
  const status: { kind: 'ok' | 'warn' | 'err' | 'idle'; label: string } =
    last == null
      ? { kind: 'idle', label: 'never run' }
      : last.promoted_variant
        ? { kind: 'ok', label: 'promoted' }
        : { kind: 'warn', label: 'no promotion' }

  return (
    <CardShell
      icon={<Sparkles size={18} />}
      title="Prompt Optimizer"
      subtitle="On demand · searches for better prompts"
      status={status}
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Metric
          label="Last round"
          value={last ? formatRelative(last.started_at) : '—'}
          hint={last?.stage ?? undefined}
        />
        <Metric label="Total rounds" value={String(snap.totalRounds)} />
        <Metric
          label="Quality Δ"
          value={
            last && last.baseline_quality != null && last.winner_quality != null
              ? `${(last.winner_quality - last.baseline_quality).toFixed(2)}`
              : '—'
          }
          hint={
            last?.baseline_quality != null
              ? `baseline ${last.baseline_quality.toFixed(2)}`
              : undefined
          }
        />
      </div>
      <div
        className="mt-4 text-[11px]"
        style={{ color: 'var(--text-muted)' }}
      >
        Manual run:{' '}
        <code className="px-1 py-0.5 rounded bg-black/5">
          npm run optimize:prompt -- recommender
        </code>
      </div>
    </CardShell>
  )
}

// ── Eval card ────────────────────────────────────────────────

function EvalCard({ snap }: { snap: EvalSnapshot }) {
  const last = snap.lastRun
  const passPct =
    last && last.total_cases > 0
      ? (last.total_pass / last.total_cases) * 100
      : null
  const status: { kind: 'ok' | 'warn' | 'err' | 'idle'; label: string } =
    last == null
      ? { kind: 'idle', label: 'never run' }
      : passPct != null && passPct < 70
        ? { kind: 'warn', label: 'low pass rate' }
        : { kind: 'ok', label: 'healthy' }

  return (
    <CardShell
      icon={<Beaker size={18} />}
      title="/labs Eval"
      subtitle="On demand · regression suite for /labs agent"
      status={status}
      footer={
        <Link
          href="/labs/eval"
          className="text-xs font-medium px-3 py-1.5 rounded border inline-flex items-center transition-opacity hover:opacity-70"
          style={{
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-primary)',
          }}
        >
          Open /labs/eval
        </Link>
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Metric
          label="Last run"
          value={last ? formatRelative(last.started_at) : '—'}
          hint={last?.git_sha?.slice(0, 7) ?? undefined}
        />
        <Metric
          label="Pass rate"
          value={passPct != null ? `${passPct.toFixed(0)}%` : '—'}
          hint={
            last ? `${last.total_pass}/${last.total_cases}` : undefined
          }
        />
        <Metric
          label="Avg quality"
          value={last ? last.avg_quality.toFixed(2) : '—'}
        />
        <Metric
          label="Cost"
          value={last ? `$${last.total_cost_usd.toFixed(4)}` : '—'}
        />
      </div>
      <div
        className="mt-4 text-[11px]"
        style={{ color: 'var(--text-muted)' }}
      >
        Manual run:{' '}
        <code className="px-1 py-0.5 rounded bg-black/5">npm run eval</code>
      </div>
    </CardShell>
  )
}

// ── Footer / runbook ─────────────────────────────────────────

function RunbookFooter() {
  return (
    <section
      className="rounded-lg border p-4 text-[12px] leading-relaxed"
      style={{
        borderColor: 'var(--border-subtle)',
        backgroundColor: 'var(--surface-1)',
        color: 'var(--text-secondary)',
      }}
    >
      <div
        className="font-medium mb-1 flex items-center gap-2"
        style={{ color: 'var(--text-primary)' }}
      >
        <CheckCircle2 size={13} />
        Triggers
      </div>
      Scout runs every 4 hours via Vercel Cron (<code>vercel.json</code> →{' '}
      <code>/api/scout</code>). Curator and Coverage Gap run on the Cowork
      schedule. Optimizer and Eval are manual. To wire any of the
      manual-only agents up to a button here, add an HTTP entrypoint
      mirroring <code>/api/scout</code> and a server action that POSTs to
      it.
    </section>
  )
}

// ── Utilities ────────────────────────────────────────────────

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

function dotColor(status: string): string {
  switch (status) {
    case 'success':
      return 'var(--yes)'
    case 'error':
      return 'var(--no)'
    case 'partial':
    case 'cap_hit':
    case 'skipped':
      return 'var(--kinda)'
    default:
      return 'var(--text-muted)'
  }
}
