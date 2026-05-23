// ─────────────────────────────────────────────────────────────
// /labs/eval — server-rendered dashboard for the labs eval harness.
//
// What it shows:
//   - Top-line metrics for the most recent run
//   - Line chart of avg quality across the last N runs
//   - Secondary line charts: cost per run, latency per case
//   - Per-case history table, with red/green regression highlighting
//     against the previous run for the same case
//
// Reads only from Supabase (public RLS), no client-side data fetching.
// ─────────────────────────────────────────────────────────────

import Link from 'next/link'
import { ChevronLeft, ChevronRight, TrendingDown, TrendingUp, Minus } from 'lucide-react'
import {
  getRecentRuns,
  getActiveCases,
  getResultsMatrix,
  type EvalRunRow,
  type EvalResultRow,
} from '@/lib/labs/eval-queries'
import { LineChart, type LinePoint } from './_components/LineChart'

export const metadata = {
  title: 'Labs Eval — Cafelist',
  description:
    'Quality, cost, and latency trends for the /labs agent pipeline across every `npm run eval` invocation.',
}

// Server-render fresh each request — eval data changes on demand,
// not on a fixed schedule.
export const dynamic = 'force-dynamic'

const RUN_WINDOW = 20

export default async function LabsEvalPage() {
  const [runs, cases] = await Promise.all([getRecentRuns(RUN_WINDOW), getActiveCases()])

  const runIds = runs.map((r) => r.run_id)
  const matrix = await getResultsMatrix(runIds)

  const latest = runs[0] ?? null
  const previous = runs[1] ?? null

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
      {/* ── Top bar ─────────────────────────────────────────── */}
      <div
        className="sticky top-0 z-20 border-b"
        style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <Link
            href="/labs"
            className="inline-flex items-center gap-1 text-xs font-medium transition-opacity hover:opacity-70"
            style={{ color: 'var(--text-muted)' }}
          >
            <ChevronLeft size={13} />
            Back to Labs
          </Link>
          <span
            className="ml-auto wordmark text-[15px] flex items-center gap-2"
            style={{ color: 'var(--text-primary)' }}
          >
            <span>Cafelist</span>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide"
              style={{ backgroundColor: 'var(--accent-glow)', color: 'var(--accent)' }}
            >
              Eval
            </span>
          </span>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-10">
        {/* ── Heading ──────────────────────────────────────── */}
        <section>
          <h1
            className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-fraunces)' }}
          >
            Did the change make it better?
          </h1>
          <p
            className="text-sm leading-relaxed max-w-3xl"
            style={{ color: 'var(--text-secondary)' }}
          >
            Every <code>npm run eval</code> runs the {cases.length}-case fixture suite end-to-end,
            grades each result deterministically, then asks Haiku for a quality score. Compare runs
            here to see whether a prompt edit moved the needle — and which specific cases moved.
          </p>
        </section>

        {/* ── Latest-run summary ───────────────────────────── */}
        {latest ? (
          <LatestRunPanel run={latest} previous={previous} />
        ) : (
          <EmptyState />
        )}

        {/* ── Trend charts ─────────────────────────────────── */}
        {runs.length >= 2 ? <TrendCharts runs={runs} /> : null}

        {/* ── Per-case table ───────────────────────────────── */}
        {latest ? (
          <PerCaseTable
            runs={runs}
            cases={cases.map((c) => c.case_id)}
            matrix={matrix}
            latestRunId={latest.run_id}
            previousRunId={previous?.run_id ?? null}
          />
        ) : null}
      </div>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────

function EmptyState() {
  return (
    <div
      className="rounded-lg border p-6 text-sm"
      style={{
        borderColor: 'var(--border-subtle)',
        color: 'var(--text-secondary)',
        backgroundColor: 'var(--surface-1)',
      }}
    >
      <div className="font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
        No eval runs yet.
      </div>
      Run <code className="text-xs px-1 py-0.5 rounded bg-black/5">npm run eval</code> from the
      repo root. Results will appear here.
    </div>
  )
}

function LatestRunPanel({
  run,
  previous,
}: {
  run: EvalRunRow
  previous: EvalRunRow | null
}) {
  const passPct = run.total_cases > 0 ? (run.total_pass / run.total_cases) * 100 : 0
  const dQuality = previous ? Number(run.avg_quality) - Number(previous.avg_quality) : null
  const dCost = previous ? Number(run.total_cost_usd) - Number(previous.total_cost_usd) : null
  const dPass = previous
    ? passPct - (previous.total_cases > 0 ? (previous.total_pass / previous.total_cases) * 100 : 0)
    : null

  return (
    <section
      className="rounded-lg border p-5"
      style={{
        borderColor: 'var(--border-subtle)',
        backgroundColor: 'var(--surface-1)',
      }}
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <div
            className="text-[11px] font-medium uppercase tracking-wide"
            style={{ color: 'var(--text-muted)' }}
          >
            Latest run
          </div>
          <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            {formatDate(run.started_at)}{' '}
            {run.git_sha ? (
              <span
                className="text-[11px] ml-2 px-1.5 py-0.5 rounded font-mono"
                style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }}
              >
                {run.git_sha.slice(0, 7)}
              </span>
            ) : null}
          </div>
        </div>
        <PromptVersionsBadge versions={run.prompt_versions} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Metric label="Pass rate" value={`${passPct.toFixed(0)}%`} delta={dPass} unit="pp" />
        <Metric
          label="Avg quality"
          value={Number(run.avg_quality).toFixed(2)}
          delta={dQuality}
          unit=""
        />
        <Metric
          label="Total cost"
          value={`$${Number(run.total_cost_usd).toFixed(4)}`}
          delta={dCost}
          unit="$"
          // For cost, less is better — flip the directional color.
          lowerIsBetter
        />
        <Metric
          label="Cases"
          value={`${run.total_pass} / ${run.total_cases}`}
          delta={null}
          unit=""
        />
      </div>
    </section>
  )
}

function Metric({
  label,
  value,
  delta,
  unit,
  lowerIsBetter,
}: {
  label: string
  value: string
  delta: number | null
  unit: string
  lowerIsBetter?: boolean
}) {
  let arrow: React.ReactNode = null
  let color = 'var(--text-muted)'
  if (delta != null && Math.abs(delta) > (unit === '$' ? 0.0001 : 0.005)) {
    const positiveIsGood = !lowerIsBetter
    const improved = positiveIsGood ? delta > 0 : delta < 0
    if (improved) {
      arrow = <TrendingUp size={12} />
      color = 'var(--success, #16a34a)'
    } else {
      arrow = <TrendingDown size={12} />
      color = 'var(--danger, #dc2626)'
    }
  } else if (delta != null) {
    arrow = <Minus size={12} />
  }

  const deltaLabel = (() => {
    if (delta == null) return null
    if (unit === '$') return `${delta >= 0 ? '+' : ''}$${delta.toFixed(4)}`
    if (unit === 'pp') return `${delta >= 0 ? '+' : ''}${delta.toFixed(0)}pp`
    return `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`
  })()

  return (
    <div>
      <div
        className="text-[11px] font-medium uppercase tracking-wide mb-1"
        style={{ color: 'var(--text-muted)' }}
      >
        {label}
      </div>
      <div className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
        {value}
      </div>
      {deltaLabel ? (
        <div
          className="text-[11px] mt-0.5 inline-flex items-center gap-1"
          style={{ color }}
        >
          {arrow}
          {deltaLabel}
          <span style={{ color: 'var(--text-muted)' }}>vs prev</span>
        </div>
      ) : null}
    </div>
  )
}

function PromptVersionsBadge({ versions }: { versions: Record<string, string> }) {
  const entries = Object.entries(versions ?? {})
  if (entries.length === 0) return null
  return (
    <div className="text-right hidden sm:block">
      <div
        className="text-[11px] font-medium uppercase tracking-wide"
        style={{ color: 'var(--text-muted)' }}
      >
        Prompt hashes
      </div>
      <div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
        {entries.map(([k, v]) => (
          <div key={k}>
            {k}: <span style={{ color: 'var(--text-secondary)' }}>{v.slice(0, 8)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TrendCharts({ runs }: { runs: EvalRunRow[] }) {
  // Oldest → newest for left→right reading.
  const ordered = [...runs].reverse()
  const qualityPts: LinePoint[] = ordered.map((r, i) => ({
    label: shortLabel(r.started_at, i, ordered.length),
    value: Number(r.avg_quality),
    title: `${formatDate(r.started_at)} — ${Number(r.avg_quality).toFixed(2)} avg quality`,
  }))
  const costPts: LinePoint[] = ordered.map((r, i) => ({
    label: shortLabel(r.started_at, i, ordered.length),
    value: Number(r.total_cost_usd),
    title: `${formatDate(r.started_at)} — $${Number(r.total_cost_usd).toFixed(4)}`,
  }))
  const passPts: LinePoint[] = ordered.map((r, i) => ({
    label: shortLabel(r.started_at, i, ordered.length),
    value: r.total_cases > 0 ? (r.total_pass / r.total_cases) * 100 : 0,
    title: `${formatDate(r.started_at)} — ${r.total_pass}/${r.total_cases}`,
  }))

  return (
    <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <ChartCard>
        <LineChart
          data={qualityPts}
          yMin={0}
          yMax={10}
          title="Avg quality across runs"
          caption="Judge score, 0–10. Higher is better."
          formatY={(v) => v.toFixed(1)}
        />
      </ChartCard>
      <ChartCard>
        <LineChart
          data={passPts}
          yMin={0}
          yMax={100}
          title="Pass rate"
          caption="Share of cases passing both deterministic checks and judge."
          formatY={(v) => `${v.toFixed(0)}%`}
        />
      </ChartCard>
      <ChartCard>
        <LineChart
          data={costPts}
          title="Cost per run (USD)"
          caption="Target: ≈ $0.05 per full eval run."
          formatY={(v) => `$${v.toFixed(4)}`}
        />
      </ChartCard>
      <ChartCard>
        <LatencyByCaseChart runs={runs} />
      </ChartCard>
    </section>
  )
}

function ChartCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg border p-4"
      style={{
        borderColor: 'var(--border-subtle)',
        backgroundColor: 'var(--surface-1)',
      }}
    >
      {children}
    </div>
  )
}

async function LatencyByCaseChart({ runs }: { runs: EvalRunRow[] }) {
  // Average per-run case latency: total_duration_summed / total_cases.
  // We don't have that aggregate, so we compute from results.
  const runIds = runs.map((r) => r.run_id)
  const matrix = await getResultsMatrix(runIds)
  const ordered = [...runs].reverse()
  const pts: LinePoint[] = ordered.map((r, i) => {
    const results: EvalResultRow[] = []
    for (const c of matrix.values()) {
      if (c.run_id === r.run_id) results.push(c)
    }
    const avg =
      results.length > 0
        ? results.reduce((s, x) => s + x.latency_ms, 0) / results.length
        : 0
    return {
      label: shortLabel(r.started_at, i, ordered.length),
      value: avg,
      title: `${formatDate(r.started_at)} — ${avg.toFixed(0)}ms avg per case`,
    }
  })
  return (
    <LineChart
      data={pts}
      title="Avg latency per case (ms)"
      caption="Wall-clock time per case end-to-end."
      formatY={(v) => `${Math.round(v)}ms`}
    />
  )
}

function PerCaseTable({
  runs,
  cases,
  matrix,
  latestRunId,
  previousRunId,
}: {
  runs: EvalRunRow[]
  cases: string[]
  matrix: Map<string, EvalResultRow>
  latestRunId: string
  previousRunId: string | null
}) {
  // Latest result and previous result keyed by case.
  const rows = cases.map((caseId) => {
    const latest = matrix.get(`${latestRunId}:${caseId}`) ?? null
    const prev = previousRunId ? matrix.get(`${previousRunId}:${caseId}`) ?? null : null
    return { caseId, latest, prev }
  })

  // Sort: regressions first, then improvements, then stable.
  rows.sort((a, b) => {
    return weight(a) - weight(b)
    function weight(r: typeof a) {
      const diff = regressionDirection(r.latest, r.prev)
      if (diff === 'regression') return 0
      if (diff === 'improvement') return 1
      return 2
    }
  })

  // Show up to 4 most-recent runs as compact pass/fail columns.
  const compactRuns = runs.slice(0, Math.min(4, runs.length))

  return (
    <section>
      <div
        className="text-[11px] font-medium uppercase tracking-wide mb-2"
        style={{ color: 'var(--text-muted)' }}
      >
        Per-case history
      </div>
      <div
        className="rounded-lg border overflow-x-auto"
        style={{
          borderColor: 'var(--border-subtle)',
          backgroundColor: 'var(--surface-1)',
        }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--border-subtle)' }}>
              <Th>Case</Th>
              <Th align="right">Quality</Th>
              <Th align="right">Δ</Th>
              <Th align="right">Cost</Th>
              <Th align="right">Latency</Th>
              {compactRuns.map((r) => (
                <Th key={r.run_id} align="center">
                  {shortLabel(r.started_at, 0, 1)}
                </Th>
              ))}
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ caseId, latest, prev }) => {
              const dir = regressionDirection(latest, prev)
              const rowBg =
                dir === 'regression'
                  ? 'rgba(220, 38, 38, 0.06)'
                  : dir === 'improvement'
                  ? 'rgba(22, 163, 74, 0.06)'
                  : 'transparent'
              return (
                <tr
                  key={caseId}
                  className="border-b"
                  style={{
                    borderColor: 'var(--border-subtle)',
                    backgroundColor: rowBg,
                  }}
                >
                  <td className="px-3 py-2 align-top">
                    <Link
                      href={`/labs/eval/case/${encodeURIComponent(caseId)}`}
                      className="font-medium hover:underline"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {caseId}
                    </Link>
                    {latest?.deterministic_fails?.length ? (
                      <div className="text-[11px] mt-0.5" style={{ color: 'var(--danger, #dc2626)' }}>
                        failed: {latest.deterministic_fails.join(', ')}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 align-top text-right">
                    {latest?.quality_score != null ? Number(latest.quality_score).toFixed(1) : '—'}
                  </td>
                  <td className="px-3 py-2 align-top text-right">
                    <DeltaCell latest={latest} prev={prev} />
                  </td>
                  <td className="px-3 py-2 align-top text-right">
                    {latest ? `$${Number(latest.cost_usd).toFixed(4)}` : '—'}
                  </td>
                  <td className="px-3 py-2 align-top text-right">
                    {latest ? `${latest.latency_ms}ms` : '—'}
                  </td>
                  {compactRuns.map((r) => {
                    const hit = matrix.get(`${r.run_id}:${caseId}`)
                    return (
                      <td key={r.run_id} className="px-3 py-2 align-top text-center">
                        <PassDot res={hit} />
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 align-top text-right">
                    <Link
                      href={`/labs/eval/case/${encodeURIComponent(caseId)}`}
                      className="inline-flex items-center text-xs"
                      style={{ color: 'var(--accent)' }}
                    >
                      Trace <ChevronRight size={12} />
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
        Click any case to see the full trace, diffed against the previous run.
      </div>
    </section>
  )
}

function Th({
  children,
  align = 'left',
}: {
  children?: React.ReactNode
  align?: 'left' | 'right' | 'center'
}) {
  return (
    <th
      className="px-3 py-2 text-[11px] font-medium uppercase tracking-wide"
      style={{ color: 'var(--text-muted)', textAlign: align }}
    >
      {children}
    </th>
  )
}

function PassDot({ res }: { res: EvalResultRow | undefined }) {
  if (!res) {
    return <span style={{ color: 'var(--text-muted)' }}>—</span>
  }
  const passOverall = res.pass_deterministic && res.pass_judge !== false
  const color = passOverall ? 'var(--success, #16a34a)' : 'var(--danger, #dc2626)'
  return (
    <span
      style={{ color }}
      title={`det:${res.pass_deterministic ? '✓' : '✗'} judge:${
        res.pass_judge == null ? '–' : res.pass_judge ? '✓' : '✗'
      } q:${res.quality_score ?? '—'}`}
    >
      {passOverall ? '●' : '○'}
    </span>
  )
}

function DeltaCell({
  latest,
  prev,
}: {
  latest: EvalResultRow | null
  prev: EvalResultRow | null
}) {
  if (!latest || !prev || latest.quality_score == null || prev.quality_score == null) {
    return <span style={{ color: 'var(--text-muted)' }}>—</span>
  }
  const d = Number(latest.quality_score) - Number(prev.quality_score)
  if (Math.abs(d) < 0.05)
    return <span style={{ color: 'var(--text-muted)' }}>±0</span>
  const color = d > 0 ? 'var(--success, #16a34a)' : 'var(--danger, #dc2626)'
  return (
    <span style={{ color }}>
      {d > 0 ? '+' : ''}
      {d.toFixed(1)}
    </span>
  )
}

function regressionDirection(
  latest: EvalResultRow | null,
  prev: EvalResultRow | null
): 'regression' | 'improvement' | 'stable' {
  if (!latest || !prev) return 'stable'
  const latestPass = latest.pass_deterministic && latest.pass_judge !== false
  const prevPass = prev.pass_deterministic && prev.pass_judge !== false
  if (prevPass && !latestPass) return 'regression'
  if (!prevPass && latestPass) return 'improvement'
  const lq = latest.quality_score == null ? null : Number(latest.quality_score)
  const pq = prev.quality_score == null ? null : Number(prev.quality_score)
  if (lq != null && pq != null) {
    if (lq - pq <= -0.5) return 'regression'
    if (lq - pq >= 0.5) return 'improvement'
  }
  return 'stable'
}

function shortLabel(iso: string, _i: number, _len: number): string {
  // "May 14" — compact, sortable in context.
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
