// ─────────────────────────────────────────────────────────────
// /admin/status — Mission Control.
//
// One page, no clicking around: is the data trustworthy, are the
// agents alive, is the stack configured and reachable, is the SEO
// surface healthy. Agent detail still lives at /admin/ops — this
// page shows a condensed version of it plus everything ops doesn't
// cover, so "quickly monitor things in one place" means this page,
// not five.
//
// Gated by the same /admin Basic Auth as every other admin route
// (see src/middleware.ts) — nothing new to configure for "only I
// can access this."
// ─────────────────────────────────────────────────────────────

import Link from 'next/link'
import {
  ChevronLeft,
  RefreshCw,
  Clock,
  Database,
  Bot,
  Server,
  Search,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  AlertTriangle,
} from 'lucide-react'
import { revalidatePath } from 'next/cache'
import { getStatusSnapshot } from '@/lib/admin/status-queries'
import { getOpsSnapshot } from '@/lib/admin/ops-queries'

export const metadata = {
  title: 'Mission Control — Cafelist',
  description: 'One-page status view: data health, agents, tech stack, and SEO.',
}

export const dynamic = 'force-dynamic'

async function refreshAction(): Promise<void> {
  'use server'
  revalidatePath('/admin/status')
}

export default async function StatusPage() {
  const [status, ops] = await Promise.all([getStatusSnapshot(), getOpsSnapshot()])

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
      <TopBar fetchedAt={status.fetchedAt} />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <header className="space-y-2">
          <h1
            className="text-2xl sm:text-3xl font-semibold tracking-tight"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-fraunces)' }}
          >
            Mission control
          </h1>
          <p
            className="text-sm leading-relaxed max-w-3xl"
            style={{ color: 'var(--text-secondary)' }}
          >
            Everything worth knowing about the state of the business, in one
            glance: data you can trust, agents that should be running, the
            stack underneath, and how the public site looks to search.
          </p>
        </header>

        <PipelineBanner business={status.business} />

        <Section title="Business pulse" icon={<Database size={16} />}>
          <BusinessPulseCard business={status.business} />
        </Section>

        <Section
          title="Agents"
          icon={<Bot size={16} />}
          action={
            <Link
              href="/admin/ops"
              className="text-xs font-medium transition-opacity hover:opacity-70"
              style={{ color: 'var(--accent)' }}
            >
              Full agent detail →
            </Link>
          }
        >
          <AgentsCondensed ops={ops} />
        </Section>

        <Section title="Tech stack & infra" icon={<Server size={16} />}>
          <TechStackCard techStack={status.techStack} />
        </Section>

        <Section title="SEO" icon={<Search size={16} />}>
          <SeoCard seo={status.seo} />
        </Section>
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
        <Link
          href="/admin/ops"
          className="text-xs font-medium transition-opacity hover:opacity-70"
          style={{ color: 'var(--accent)' }}
        >
          Agent ops
        </Link>
        <Link
          href="/admin/analytics"
          className="text-xs font-medium transition-opacity hover:opacity-70"
          style={{ color: 'var(--accent)' }}
        >
          Analytics
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
            Mission Control
          </span>
        </span>
      </div>
    </div>
  )
}

// ── Shared section shell ──────────────────────────────────────

function Section({
  title,
  icon,
  action,
  children,
}: {
  title: string
  icon: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <div style={{ color: 'var(--accent)' }}>{icon}</div>
        <h2
          className="text-sm font-semibold uppercase tracking-wide"
          style={{ color: 'var(--text-primary)' }}
        >
          {title}
        </h2>
        {action ? <div className="ml-auto">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg border p-5"
      style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface-1)' }}
    >
      {children}
    </div>
  )
}

function Metric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'ok' | 'warn' | 'err' }) {
  const color =
    tone === 'ok' ? 'var(--yes)' : tone === 'warn' ? 'var(--kinda)' : tone === 'err' ? 'var(--no)' : 'var(--text-primary)'
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide font-medium" style={{ color: 'var(--text-muted)' }}>
        {label}
      </div>
      <div className="text-base font-medium tabular-nums" style={{ color }}>
        {value}
      </div>
      {hint ? (
        <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {hint}
        </div>
      ) : null}
    </div>
  )
}

function Dot({ color }: { color: string }) {
  return <span className="w-1.5 h-1.5 rounded-full shrink-0 inline-block" style={{ backgroundColor: color }} />
}

// ── Pipeline banner — the single most important fact on the page ──

function PipelineBanner({ business }: { business: import('@/lib/admin/status-queries').BusinessPulse }) {
  const days = business.pipelineDormantDays
  if (days == null) return null

  const dormant = days > 2
  if (!dormant) return null

  return (
    <div
      className="rounded-lg border p-4 flex items-start gap-3"
      style={{ borderColor: 'rgba(168,57,47,0.3)', backgroundColor: 'rgba(168,57,47,0.06)' }}
    >
      <AlertTriangle size={18} style={{ color: 'var(--no)' }} className="shrink-0 mt-0.5" />
      <div>
        <div className="text-sm font-medium" style={{ color: 'var(--no)' }}>
          Pipeline has been quiet for {days} days
        </div>
        <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          No new spot discovered, no admin approval, and no Curator score more
          recently than {days} days ago. Check whether the Scout/Curator crons
          are actually authenticating (CRON_SECRET) — see the Tech stack
          section below and the Agents panel.
        </div>
      </div>
    </div>
  )
}

// ── Business pulse ───────────────────────────────────────────

function BusinessPulseCard({
  business,
}: {
  business: import('@/lib/admin/status-queries').BusinessPulse
}) {
  const { counts, dataConfidence } = business
  const total = counts.approved + counts.pending + counts.rejected
  const verifiedShare = counts.approved > 0 ? dataConfidence.verified / counts.approved : null

  return (
    <CardShell>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Metric label="Approved (live)" value={String(counts.approved)} tone="ok" />
        <Metric label="Pending review" value={String(counts.pending)} tone={counts.pending > 0 ? 'warn' : undefined} />
        <Metric label="Rejected" value={String(counts.rejected)} />
        <Metric label="Total ever discovered" value={String(total)} />
      </div>

      <div className="mt-5 pt-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="text-[10px] uppercase tracking-wide font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
          Confidence, of {counts.approved} live spots
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Metric
            label="Verified"
            value={String(dataConfidence.verified)}
            hint={verifiedShare != null ? `${(verifiedShare * 100).toFixed(0)}%` : undefined}
            tone={dataConfidence.verified === 0 ? 'err' : 'ok'}
          />
          <Metric label="Inferred" value={String(dataConfidence.inferred)} tone="warn" />
          <Metric label="Unknown" value={String(dataConfidence.unknown)} />
        </div>
        {dataConfidence.verified === 0 && counts.approved > 0 ? (
          <div className="mt-3 text-[12px] flex items-start gap-2" style={{ color: 'var(--no)' }}>
            <ShieldAlert size={13} className="mt-0.5 shrink-0" />
            <span>
              Zero live spots are marked &quot;verified&quot; — the confidence
              column is frozen at its one-time migration snapshot and doesn&apos;t
              yet update when an admin re-approves a spot. See the data-quality
              audit for the fix.
            </span>
          </div>
        ) : null}
      </div>

      <div className="mt-5 pt-4 border-t grid grid-cols-3 gap-4" style={{ borderColor: 'var(--border-subtle)' }}>
        <Metric label="Last spot discovered" value={relativeOrDash(business.lastSpotCreated)} />
        <Metric label="Last admin approval" value={relativeOrDash(business.lastAdminApproval)} />
        <Metric label="Last Curator score" value={relativeOrDash(business.lastWorkabilityScore)} />
      </div>
    </CardShell>
  )
}

// ── Agents (condensed — full detail at /admin/ops) ───────────

function AgentsCondensed({ ops: snap }: { ops: Awaited<ReturnType<typeof getOpsSnapshot>> }) {
  const rows: Array<{ name: string; status: { kind: 'ok' | 'warn' | 'err' | 'idle'; label: string }; detail: string }> = [
    {
      name: 'Scout',
      status: scoutStatus(snap.scout),
      detail: snap.scout.lastRun
        ? `last run ${formatRelative(snap.scout.lastRun.started_at)} · +${snap.scout.lastRun.candidates_inserted} inserted`
        : 'never run',
    },
    {
      name: 'Curator',
      status:
        snap.curator.scoredAllTime === 0
          ? { kind: 'idle', label: 'never run' }
          : { kind: 'ok', label: 'healthy' },
      detail: snap.curator.lastScoredAt
        ? `last score ${formatRelative(snap.curator.lastScoredAt)} · ${snap.curator.pendingRescore} pending rescore`
        : 'never run',
    },
    {
      name: 'Coverage Gap',
      status: snap.coverageGap.queriesLast7d === 0 ? { kind: 'idle', label: 'no queries 7d' } : { kind: 'ok', label: 'healthy' },
      detail: `${snap.coverageGap.queriesLast7d} queries (7d) · ${snap.coverageGap.activeCoverageGapPriorities} active priorities`,
    },
    {
      name: 'Prompt Optimizer',
      status: snap.optimizer.lastRound == null ? { kind: 'idle', label: 'never run' } : { kind: 'ok', label: 'ran' },
      detail: snap.optimizer.lastRound ? `last round ${formatRelative(snap.optimizer.lastRound.started_at)}` : 'on demand',
    },
    {
      name: '/labs Eval',
      status: snap.eval.lastRun == null ? { kind: 'idle', label: 'never run' } : { kind: 'ok', label: 'ran' },
      detail: snap.eval.lastRun ? `last run ${formatRelative(snap.eval.lastRun.started_at)}` : 'on demand',
    },
  ]

  return (
    <CardShell>
      <ul className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
        {rows.map((r) => (
          <li key={r.name} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
            <Dot color={dotColor(r.status.kind)} />
            <span className="text-sm font-medium w-36 shrink-0" style={{ color: 'var(--text-primary)' }}>
              {r.name}
            </span>
            <span className="text-[11px] uppercase tracking-wide font-semibold w-24 shrink-0" style={{ color: pillColor(r.status.kind) }}>
              {r.status.label}
            </span>
            <span className="text-[12px] truncate" style={{ color: 'var(--text-secondary)' }}>
              {r.detail}
            </span>
          </li>
        ))}
      </ul>
    </CardShell>
  )
}

function scoutStatus(snap: Awaited<ReturnType<typeof getOpsSnapshot>>['scout']): { kind: 'ok' | 'warn' | 'err' | 'idle'; label: string } {
  if (!snap.lastRun) return { kind: 'idle', label: 'never run' }
  const s = snap.lastRun.status
  if (s === 'error') return { kind: 'err', label: 'errored' }
  if (s === 'cap_hit' || s === 'skipped' || s === 'partial') return { kind: 'warn', label: s.replace('_', ' ') }
  return { kind: 'ok', label: 'healthy' }
}

// ── Tech stack ────────────────────────────────────────────────

function TechStackCard({ techStack }: { techStack: import('@/lib/admin/status-queries').TechStackSnapshot }) {
  return (
    <CardShell>
      <div className="grid sm:grid-cols-2 gap-6">
        <div>
          <div className="text-[10px] uppercase tracking-wide font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
            Stack
          </div>
          <ul className="space-y-1.5 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
            <li className="flex justify-between">
              <span style={{ color: 'var(--text-primary)' }}>{techStack.framework.name}</span>
              <span className="tabular-nums">{techStack.framework.version}</span>
            </li>
            {techStack.runtime.map((r) => (
              <li key={r.name} className="flex justify-between">
                <span>{r.name}</span>
                <span className="tabular-nums">{r.version}</span>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-center gap-2">
            <Dot color={techStack.supabaseReachable ? 'var(--yes)' : 'var(--no)'} />
            <span className="text-[13px]" style={{ color: 'var(--text-primary)' }}>
              Supabase {techStack.supabaseReachable ? 'reachable' : 'unreachable'}
            </span>
            {techStack.supabaseLatencyMs != null ? (
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                ({techStack.supabaseLatencyMs}ms)
              </span>
            ) : null}
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wide font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
            Secrets &amp; config (presence only — never values)
          </div>
          <ul className="space-y-1.5">
            {techStack.envChecks.map((c) => (
              <li key={c.name} className="flex items-center gap-2 text-[12px]">
                {c.set ? (
                  <ShieldCheck size={13} style={{ color: 'var(--yes)' }} className="shrink-0" />
                ) : (
                  <ShieldQuestion size={13} style={{ color: 'var(--no)' }} className="shrink-0" />
                )}
                <span style={{ color: 'var(--text-primary)' }}>{c.name}</span>
                <span style={{ color: 'var(--text-muted)' }} className="ml-auto text-right">
                  {c.note}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </CardShell>
  )
}

// ── SEO ───────────────────────────────────────────────────────

function SeoCard({ seo }: { seo: import('@/lib/admin/status-queries').SeoSnapshot }) {
  return (
    <CardShell>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Metric label="Indexable spot pages" value={String(seo.publicSpotPages)} />
        <Metric
          label="Missing neighborhood"
          value={String(seo.spotPagesMissingNeighborhood)}
          tone={seo.spotPagesMissingNeighborhood > 0 ? 'warn' : 'ok'}
          hint="weaker local-SEO signal"
        />
        <Metric label="Static pages in sitemap" value={String(seo.sitemapStaticPages)} />
        <Metric label="robots.txt" value={seo.robotsAllowsIndexing ? 'allows crawling' : 'blocking'} tone={seo.robotsAllowsIndexing ? 'ok' : 'err'} />
      </div>
      <div className="mt-4 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
        Disallowed from indexing: {seo.robotsDisallowedPaths.map((p) => <code key={p} className="mx-0.5 px-1 py-0.5 rounded bg-black/5">{p}</code>)}
      </div>
      <div className="mt-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        Sitemap at <code className="px-1 py-0.5 rounded bg-black/5">{seo.siteUrl}/sitemap.xml</code>, regenerated hourly. Not connected
        here: Search Console indexing status, actual ranking positions, or backlink data — none of that is wired up yet.
      </div>
    </CardShell>
  )
}

// ── Utilities ────────────────────────────────────────────────

function relativeOrDash(iso: string | null): string {
  return iso ? formatRelative(iso) : '—'
}

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

function dotColor(kind: 'ok' | 'warn' | 'err' | 'idle'): string {
  switch (kind) {
    case 'ok':
      return 'var(--yes)'
    case 'warn':
      return 'var(--kinda)'
    case 'err':
      return 'var(--no)'
    default:
      return 'var(--text-muted)'
  }
}

function pillColor(kind: 'ok' | 'warn' | 'err' | 'idle'): string {
  return dotColor(kind)
}
