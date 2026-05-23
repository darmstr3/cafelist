// ─────────────────────────────────────────────────────────────
// /labs/eval/case/[caseId] — single-case trace view.
//
// Shows the case's hard constraints, full history (line chart of
// quality across runs), and the most-recent two traces side by
// side so a prompt edit's effect on this specific case is visible.
// ─────────────────────────────────────────────────────────────

import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { notFound } from 'next/navigation'
import { getCase, getResultsForCase, type EvalResultRow } from '@/lib/labs/eval-queries'
import { LineChart, type LinePoint } from '../../_components/LineChart'
import type { AgentRun, TraceEvent, TraceStage } from '@/lib/labs/types'

export const dynamic = 'force-dynamic'

const STAGE_LABEL: Record<TraceStage, string> = {
  intent_parser: 'Intent Parser',
  retriever: 'Retriever',
  fit_scorer: 'Fit Scorer',
  recommender: 'Recommender',
  evaluator: 'Evaluator',
}

export default async function CasePage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params
  const decoded = decodeURIComponent(caseId)
  const [caseRow, history] = await Promise.all([
    getCase(decoded),
    getResultsForCase(decoded, 30),
  ])
  if (!caseRow) notFound()

  const latest = history[0] ?? null
  const previous = history[1] ?? null

  // Build quality history chart (oldest → newest).
  const ordered = [...history].reverse()
  const qPoints: LinePoint[] = ordered
    .filter((r) => r.quality_score != null)
    .map((r) => ({
      label: new Date(r.created_at).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
      value: Number(r.quality_score),
      title: `${new Date(r.created_at).toLocaleString()} — ${Number(r.quality_score).toFixed(2)}`,
    }))

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
      <div
        className="sticky top-0 z-20 border-b"
        style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <Link
            href="/labs/eval"
            className="inline-flex items-center gap-1 text-xs font-medium transition-opacity hover:opacity-70"
            style={{ color: 'var(--text-muted)' }}
          >
            <ChevronLeft size={13} />
            Back to Eval
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

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-8">
        {/* ── Header ───────────────────────────────────────── */}
        <section>
          <div
            className="text-[11px] font-medium uppercase tracking-wide mb-1"
            style={{ color: 'var(--text-muted)' }}
          >
            Case
          </div>
          <h1
            className="text-2xl font-semibold tracking-tight mb-3"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-fraunces)' }}
          >
            {caseRow.case_id}
          </h1>
          <p
            className="text-sm italic leading-relaxed mb-4 max-w-3xl"
            style={{ color: 'var(--text-secondary)' }}
          >
            “{caseRow.query}”
          </p>
          <ConstraintsBlock constraints={caseRow.hard_constraints} tags={caseRow.tags} />
        </section>

        {/* ── Quality history chart ───────────────────────── */}
        <section
          className="rounded-lg border p-4"
          style={{
            borderColor: 'var(--border-subtle)',
            backgroundColor: 'var(--surface-1)',
          }}
        >
          <LineChart
            data={qPoints}
            yMin={0}
            yMax={10}
            title="Quality over time"
            caption={`${history.length} runs recorded.`}
            formatY={(v) => v.toFixed(1)}
          />
        </section>

        {/* ── Side-by-side trace diff ─────────────────────── */}
        {latest ? (
          <section>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <RunColumn
                heading="Most recent"
                result={latest}
                comparison={previous}
              />
              <RunColumn
                heading="Previous"
                result={previous}
                comparison={latest}
                muted={!previous}
              />
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}

// ── Components ───────────────────────────────────────────────

function ConstraintsBlock({
  constraints,
  tags,
}: {
  constraints: Record<string, unknown> | object
  tags: string[]
}) {
  const entries = Object.entries(constraints as Record<string, unknown>).filter(
    ([, v]) => v != null && v !== false
  )
  return (
    <div className="flex flex-wrap gap-2">
      {entries.map(([k, v]) => (
        <span
          key={k}
          className="text-[11px] px-2 py-1 rounded-md border"
          style={{
            borderColor: 'var(--border)',
            backgroundColor: 'var(--surface-2)',
            color: 'var(--text-secondary)',
          }}
        >
          <span style={{ color: 'var(--text-muted)' }}>{k}:</span>{' '}
          <span style={{ color: 'var(--text-primary)' }}>{String(v)}</span>
        </span>
      ))}
      {tags.map((t) => (
        <span
          key={t}
          className="text-[11px] px-2 py-1 rounded-md font-medium"
          style={{
            backgroundColor: 'var(--accent-glow)',
            color: 'var(--accent)',
          }}
        >
          #{t}
        </span>
      ))}
    </div>
  )
}

function RunColumn({
  heading,
  result,
  comparison,
  muted,
}: {
  heading: string
  result: EvalResultRow | null
  comparison: EvalResultRow | null
  muted?: boolean
}) {
  if (!result) {
    return (
      <div
        className="rounded-lg border p-4 text-sm"
        style={{
          borderColor: 'var(--border-subtle)',
          color: 'var(--text-muted)',
          opacity: muted ? 0.6 : 1,
        }}
      >
        <div
          className="text-[11px] font-medium uppercase tracking-wide mb-2"
          style={{ color: 'var(--text-muted)' }}
        >
          {heading}
        </div>
        No previous run for this case.
      </div>
    )
  }

  const run = result.full_trace as AgentRun
  const passOverall = result.pass_deterministic && result.pass_judge !== false
  return (
    <div
      className="rounded-lg border p-4 space-y-4"
      style={{
        borderColor: 'var(--border-subtle)',
        backgroundColor: 'var(--surface-1)',
      }}
    >
      <div>
        <div
          className="text-[11px] font-medium uppercase tracking-wide"
          style={{ color: 'var(--text-muted)' }}
        >
          {heading}
        </div>
        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {new Date(result.created_at).toLocaleString()}
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[11px]">
          <Pill
            label={`det ${result.pass_deterministic ? '✓' : '✗'}`}
            tone={result.pass_deterministic ? 'good' : 'bad'}
          />
          <Pill
            label={`judge ${
              result.pass_judge == null ? '–' : result.pass_judge ? '✓' : '✗'
            }`}
            tone={
              result.pass_judge == null
                ? 'muted'
                : result.pass_judge
                ? 'good'
                : 'bad'
            }
          />
          <Pill
            label={`q ${result.quality_score != null ? Number(result.quality_score).toFixed(1) : '—'}`}
            tone={
              comparison?.quality_score != null && result.quality_score != null
                ? Number(result.quality_score) > Number(comparison.quality_score) + 0.1
                  ? 'good'
                  : Number(result.quality_score) < Number(comparison.quality_score) - 0.1
                  ? 'bad'
                  : 'muted'
                : 'muted'
            }
          />
          <Pill label={`$${Number(result.cost_usd).toFixed(4)}`} tone="muted" />
          <Pill label={`${result.latency_ms}ms`} tone="muted" />
          <Pill
            label={passOverall ? 'PASS' : 'FAIL'}
            tone={passOverall ? 'good' : 'bad'}
            strong
          />
        </div>
        {result.deterministic_fails.length > 0 ? (
          <div
            className="text-[11px] mt-1.5"
            style={{ color: 'var(--danger, #dc2626)' }}
          >
            Failed checks: {result.deterministic_fails.join(', ')}
          </div>
        ) : null}
      </div>

      {/* Recommendation summary */}
      {run.recommendation ? (
        <div>
          <Section label="Recommendation">
            <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
              {run.recommendation.summary}
            </div>
            <ol className="mt-2 space-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
              {run.recommendation.picks.map((p, i) => (
                <li key={p.spotId}>
                  <span
                    className="font-mono px-1 py-0.5 rounded mr-1"
                    style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }}
                  >
                    {i + 1}
                  </span>
                  <span style={{ color: 'var(--text-primary)' }}>{p.spotName}</span>
                  <span style={{ color: 'var(--text-muted)' }}> — {p.oneLiner}</span>
                </li>
              ))}
            </ol>
            <div className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
              {run.recommendation.confidenceNote}
            </div>
          </Section>
        </div>
      ) : (
        <Section label="Recommendation">
          <span style={{ color: 'var(--text-muted)' }}>
            {run.fatalMessage ?? '(none)'}
          </span>
        </Section>
      )}

      {/* Trace per stage */}
      <Section label="Trace">
        <div className="space-y-2">
          {run.trace?.map((evt, i) => (
            <StageRow key={i} evt={evt} />
          )) ?? null}
        </div>
      </Section>
    </div>
  )
}

function StageRow({ evt }: { evt: TraceEvent }) {
  return (
    <details
      className="rounded-md border"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <summary className="px-3 py-2 cursor-pointer flex items-center justify-between text-xs">
        <span
          className="font-medium"
          style={{ color: evt.ok ? 'var(--text-primary)' : 'var(--danger, #dc2626)' }}
        >
          {STAGE_LABEL[evt.stage]}
        </span>
        <span style={{ color: 'var(--text-muted)' }}>
          {evt.durationMs}ms
          {evt.llm
            ? ` · ${evt.llm.inputTokens}+${evt.llm.outputTokens} tok · $${evt.llm.estimatedCostUsd.toFixed(4)}`
            : ''}
          {evt.ok ? '' : ' · ERROR'}
        </span>
      </summary>
      <pre
        className="text-[10.5px] leading-relaxed px-3 py-2 overflow-x-auto"
        style={{
          color: 'var(--text-secondary)',
          backgroundColor: 'var(--surface-2)',
          maxHeight: 320,
        }}
      >
{JSON.stringify(evt.ok ? evt.output : { error: evt.errorMessage }, null, 2)}
      </pre>
    </details>
  )
}

function Section({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div
        className="text-[11px] font-medium uppercase tracking-wide mb-1.5"
        style={{ color: 'var(--text-muted)' }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

function Pill({
  label,
  tone,
  strong,
}: {
  label: string
  tone: 'good' | 'bad' | 'muted'
  strong?: boolean
}) {
  const palette =
    tone === 'good'
      ? { bg: 'rgba(22, 163, 74, 0.12)', fg: 'var(--success, #16a34a)' }
      : tone === 'bad'
      ? { bg: 'rgba(220, 38, 38, 0.12)', fg: 'var(--danger, #dc2626)' }
      : { bg: 'var(--surface-2)', fg: 'var(--text-muted)' }
  return (
    <span
      className="px-1.5 py-0.5 rounded font-medium"
      style={{
        backgroundColor: palette.bg,
        color: palette.fg,
        fontWeight: strong ? 700 : 500,
      }}
    >
      {label}
    </span>
  )
}
