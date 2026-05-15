'use client'

// ─────────────────────────────────────────────────────────────
// /labs experience — single-file client component that drives the
// agentic discovery demo. Renders:
//   - the input box
//   - a status pill while the pipeline runs
//   - the final recommendation
//   - three expandable panels: Agent Trace, Evaluation, Operational Logs
//
// All state is local — no global store, no persistence. The route
// is a thin POST to /api/labs/recommend; everything below is render.
// ─────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'
import type {
  AgentRun,
  Evaluation,
  FitScore,
  ParsedIntent,
  Recommendation,
  RetrievalResult,
  TraceEvent,
  TraceStage,
} from '@/lib/labs/types'

const EXAMPLES = [
  'I need somewhere in Manhattan to work for 3 hours after 6pm, not too loud, outlets preferred, near the F train.',
  'A quiet coffee shop in Brooklyn open past midnight, must have wifi, no chains.',
  'Place to take a 90-minute call in San Francisco SoMa tomorrow morning — calm vibe, outlets, food nearby.',
  'Late-night spot in Austin to write, vibe-y, ok if a bit loud as long as wifi is solid.',
]

const STAGE_LABEL: Record<TraceStage, string> = {
  intent_parser: 'Intent Parser',
  retriever: 'Retriever',
  fit_scorer: 'Fit Scorer',
  recommender: 'Recommender',
  evaluator: 'Evaluator',
}

export function LabsExperience() {
  const [query, setQuery] = useState('')
  const [run, setRun] = useState<AgentRun | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!query.trim() || loading) return
    setLoading(true)
    setError(null)
    setRun(null)
    try {
      const res = await fetch('/api/labs/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      if (!res.ok) {
        const errPayload = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(errPayload.error ?? `HTTP ${res.status}`)
      }
      const data = (await res.json()) as AgentRun
      setRun(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* ── Top bar ──────────────────────────────────────────── */}
      <div
        className="sticky top-0 z-20 border-b"
        style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-xs font-medium transition-opacity hover:opacity-70"
            style={{ color: 'var(--text-muted)' }}
          >
            <ChevronLeft size={13} />
            Back to Cafelist
          </Link>
          <span
            className="ml-auto wordmark text-[15px] flex items-center gap-2"
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
              Labs
            </span>
          </span>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-8">
        {/* ── Heading ────────────────────────────────────────── */}
        <section>
          <h1
            className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-fraunces)' }}
          >
            Agentic discovery, in plain English.
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Tell the agent what kind of place you need. It parses your intent, retrieves
            candidates from the Cafelist directory, scores fit, drafts a recommendation,
            and grades its own work. Expand the panels below to see how it got there.
          </p>
        </section>

        {/* ── Input ──────────────────────────────────────────── */}
        <section className="space-y-3">
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder="e.g. Quiet place in Williamsburg open after 8pm, outlets, vibey, no chains."
            rows={3}
            className="w-full p-4 text-sm resize-y"
            style={{ minHeight: 96 }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={submit}
              disabled={loading || !query.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-opacity disabled:opacity-40 hover:opacity-90"
              style={{ backgroundColor: 'var(--accent)', color: 'white' }}
            >
              <Sparkles size={14} />
              {loading ? 'Thinking…' : 'Recommend'}
            </button>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              ⌘/Ctrl + Enter
            </span>
            <div className="basis-full" />
            <span
              className="text-[11px] font-medium uppercase tracking-wide"
              style={{ color: 'var(--text-muted)' }}
            >
              Try
            </span>
            {EXAMPLES.map((ex, i) => (
              <button
                key={i}
                onClick={() => setQuery(ex)}
                className="text-[11px] px-2 py-1 rounded-md border transition-colors hover:opacity-80"
                style={{
                  borderColor: 'var(--border)',
                  backgroundColor: 'var(--surface-2)',
                  color: 'var(--text-secondary)',
                }}
              >
                {ex.length > 60 ? ex.slice(0, 60) + '…' : ex}
              </button>
            ))}
          </div>
        </section>

        {error && (
          <div
            className="text-sm p-3 rounded-lg border"
            style={{
              backgroundColor: 'rgba(168,57,47,0.08)',
              borderColor: 'rgba(168,57,47,0.3)',
              color: 'var(--no)',
            }}
          >
            {error}
          </div>
        )}

        {loading && <SkeletonRun />}

        {run && <RunResult run={run} />}

        {/* ── Footer note ────────────────────────────────────── */}
        <section
          className="pt-6 border-t text-[11px] leading-relaxed"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
        >
          This is an experimental demo of agent orchestration on Cafelist&apos;s existing
          dataset. Recommendations are best-effort and may miss recent hours changes or
          local vibe shifts. The trace panels are the point — they show every step the
          agent took, what it was confident about, and what it couldn&apos;t verify.
        </section>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// Result rendering
// ─────────────────────────────────────────────────────────────

function RunResult({ run }: { run: AgentRun }) {
  if (run.fatal && !run.recommendation) {
    return (
      <section className="space-y-4">
        <div
          className="p-4 rounded-lg border text-sm space-y-2"
          style={{
            borderColor: 'rgba(168,57,47,0.3)',
            backgroundColor: 'rgba(168,57,47,0.06)',
            color: 'var(--text-primary)',
          }}
        >
          <p className="font-semibold" style={{ color: 'var(--no)' }}>
            The agent couldn&apos;t complete this run.
          </p>
          <p style={{ color: 'var(--text-secondary)' }}>{run.fatalMessage}</p>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            The trace below still shows what it managed to do.
          </p>
        </div>
        <TracePanel run={run} defaultOpen />
        <LogsPanel run={run} />
      </section>
    )
  }

  return (
    <section className="space-y-4">
      {run.recommendation && <RecommendationCard rec={run.recommendation} />}
      <TracePanel run={run} />
      {run.evaluation && <EvaluationPanel evaluation={run.evaluation} />}
      <LogsPanel run={run} />
    </section>
  )
}

function RecommendationCard({ rec }: { rec: Recommendation }) {
  return (
    <div
      className="rounded-xl border p-5 space-y-5"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
    >
      <p
        className="text-base leading-relaxed"
        style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-fraunces)' }}
      >
        {rec.summary}
      </p>

      <ol className="space-y-3">
        {rec.picks.map((p, i) => (
          <li
            key={p.spotId}
            className="flex gap-3 p-3 rounded-lg"
            style={{ backgroundColor: 'var(--surface-2)' }}
          >
            <span
              className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold"
              style={{
                backgroundColor: 'var(--accent)',
                color: 'white',
              }}
            >
              {i + 1}
            </span>
            <div className="space-y-1 min-w-0">
              <div className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                {p.spotName}
              </div>
              <div className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {p.oneLiner}
              </div>
              <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                Tradeoff: {p.tradeoff}
              </div>
            </div>
          </li>
        ))}
      </ol>

      {rec.backup && (
        <div
          className="text-sm p-3 rounded-lg border"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
        >
          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            Backup:
          </span>{' '}
          <span className="font-medium">{rec.backup.spotName}</span> — {rec.backup.oneLiner}
        </div>
      )}

      <div className="text-[12px] space-y-1" style={{ color: 'var(--text-muted)' }}>
        <div>
          <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>
            Confidence:
          </span>{' '}
          {rec.confidenceNote}
        </div>
        {rec.caveats.length > 0 && (
          <div>
            <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>
              Caveats:
            </span>{' '}
            {rec.caveats.join(' · ')}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Trace panel ──────────────────────────────────────────────

function TracePanel({ run, defaultOpen = false }: { run: AgentRun; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const totalCost = run.totalCostUsd
  return (
    <Collapsible
      open={open}
      onToggle={() => setOpen((v) => !v)}
      title="Agent Trace"
      meta={`${run.trace.length} stages · ${run.totalDurationMs}ms · $${totalCost.toFixed(6)}`}
    >
      <ol className="space-y-2">
        {run.trace.map((ev, i) => (
          <TraceStageRow key={i} ev={ev} />
        ))}
      </ol>
    </Collapsible>
  )
}

function TraceStageRow({ ev }: { ev: TraceEvent }) {
  const [open, setOpen] = useState(false)
  return (
    <li
      className="rounded-lg border overflow-hidden"
      style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface)' }}
    >
      <button
        className="w-full flex items-center gap-3 px-3 py-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight
          size={14}
          style={{
            color: 'var(--text-muted)',
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.15s',
          }}
        />
        <span
          className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded"
          style={{
            backgroundColor: ev.ok ? 'rgba(47,125,79,0.12)' : 'rgba(168,57,47,0.12)',
            color: ev.ok ? 'var(--yes)' : 'var(--no)',
          }}
        >
          {ev.ok ? 'ok' : 'err'}
        </span>
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {STAGE_LABEL[ev.stage]}
        </span>
        <span className="ml-auto flex items-center gap-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          <span>{ev.durationMs}ms</span>
          {ev.llm && (
            <span>
              {ev.llm.inputTokens}↑/{ev.llm.outputTokens}↓ · ${ev.llm.estimatedCostUsd.toFixed(6)}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          {ev.errorMessage && (
            <p className="text-[12px] mt-2" style={{ color: 'var(--no)' }}>
              Error: {ev.errorMessage}
            </p>
          )}
          <StageOutput stage={ev.stage} output={ev.output} />
        </div>
      )}
    </li>
  )
}

function StageOutput({ stage, output }: { stage: TraceStage; output: unknown }) {
  // Friendly renderers per stage, falling back to JSON.
  if (output === null || output === undefined) {
    return <pre className="text-[11px] mt-2 text-muted">—</pre>
  }
  if (stage === 'intent_parser') return <IntentSummary intent={output as ParsedIntent} />
  if (stage === 'retriever') return <RetrievalSummary retrieval={output as RetrievalResult} />
  if (stage === 'fit_scorer') return <FitScoresTable scored={output as FitScore[]} />
  // Recommender / evaluator: just show the JSON, it's already the answer.
  return <Json value={output} />
}

function IntentSummary({ intent }: { intent: ParsedIntent }) {
  const rows: Array<[string, string]> = []
  if (intent.city) rows.push(['City', intent.city])
  if (intent.neighborhood) rows.push(['Neighborhood', intent.neighborhood])
  if (intent.timeOfDay) rows.push(['Time', intent.timeOfDay])
  if (intent.durationMinutes != null)
    rows.push(['Duration', `${intent.durationMinutes} min`])
  if (intent.noiseTolerance) rows.push(['Noise tolerance', intent.noiseTolerance])
  if (intent.needsOutlets != null) rows.push(['Outlets', String(intent.needsOutlets)])
  if (intent.needsWifi != null) rows.push(['Wifi', String(intent.needsWifi)])
  if (intent.laptopFriendly != null)
    rows.push(['Laptop-friendly', String(intent.laptopFriendly)])
  if (intent.needsFood != null) rows.push(['Food', String(intent.needsFood)])
  if (intent.transit.length) rows.push(['Transit', intent.transit.join(', ')])
  if (intent.vibe.length) rows.push(['Vibe', intent.vibe.join(', ')])
  if (intent.avoid.length) rows.push(['Avoid', intent.avoid.join(', ')])
  if (intent.preferredTypes.length)
    rows.push(['Type', intent.preferredTypes.join(', ')])

  return (
    <div className="mt-3 space-y-3">
      <table className="text-[12px] w-full">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td
                className="pr-3 py-0.5 align-top"
                style={{ color: 'var(--text-muted)', width: 130 }}
              >
                {k}
              </td>
              <td style={{ color: 'var(--text-primary)' }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {Object.keys(intent.priorities).length > 0 && (
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          Priorities:{' '}
          {Object.entries(intent.priorities)
            .map(([k, v]) => `${k}=${v}`)
            .join(' · ')}
        </div>
      )}
    </div>
  )
}

function RetrievalSummary({ retrieval }: { retrieval: RetrievalResult }) {
  return (
    <div className="mt-3 space-y-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
      <div>
        <span style={{ color: 'var(--text-muted)' }}>Source:</span> {retrieval.source}{' '}
        <span style={{ color: 'var(--text-muted)' }}>· searched:</span>{' '}
        {retrieval.totalSearched}{' '}
        <span style={{ color: 'var(--text-muted)' }}>· kept:</span>{' '}
        {retrieval.candidates.length}
      </div>
      {retrieval.filtersApplied.length > 0 && (
        <div>
          <span style={{ color: 'var(--text-muted)' }}>Filters:</span>{' '}
          {retrieval.filtersApplied.join(' · ')}
        </div>
      )}
      <ul className="space-y-0.5 list-disc list-inside">
        {retrieval.candidates.slice(0, 10).map((c) => (
          <li key={c.id} style={{ color: 'var(--text-primary)' }}>
            {c.name}{' '}
            <span style={{ color: 'var(--text-muted)' }}>
              · {c.neighborhood ?? c.city} · work {c.work_score.toFixed(1)}
            </span>
          </li>
        ))}
        {retrieval.candidates.length > 10 && (
          <li style={{ color: 'var(--text-muted)' }}>
            …and {retrieval.candidates.length - 10} more
          </li>
        )}
      </ul>
    </div>
  )
}

function FitScoresTable({ scored }: { scored: FitScore[] }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="text-[12px] w-full">
        <thead>
          <tr style={{ color: 'var(--text-muted)' }} className="text-left">
            <th className="py-1 pr-3 font-medium">Spot</th>
            <th className="py-1 pr-3 font-medium">Fit</th>
            <th className="py-1 pr-3 font-medium">Conf.</th>
            <th className="py-1 pr-3 font-medium">Loc/Time/Noise/Feat/Vibe</th>
          </tr>
        </thead>
        <tbody>
          {scored.slice(0, 6).map((s) => (
            <tr key={s.spotId} style={{ color: 'var(--text-primary)' }}>
              <td className="py-1 pr-3">{s.spotName}</td>
              <td className="py-1 pr-3 font-semibold">{s.fitScore}</td>
              <td className="py-1 pr-3" style={{ color: 'var(--text-muted)' }}>
                {(s.confidence * 100).toFixed(0)}%
              </td>
              <td className="py-1 pr-3" style={{ color: 'var(--text-muted)' }}>
                {s.componentScores.location} · {s.componentScores.time} ·{' '}
                {s.componentScores.noise} · {s.componentScores.features} ·{' '}
                {s.componentScores.vibe}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <details className="mt-3 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
        <summary className="cursor-pointer" style={{ color: 'var(--text-muted)' }}>
          Show reasons / tradeoffs / missing data
        </summary>
        <div className="mt-2 space-y-2">
          {scored.slice(0, 4).map((s) => (
            <div key={s.spotId}>
              <div
                className="font-semibold text-[12px]"
                style={{ color: 'var(--text-primary)' }}
              >
                {s.spotName}
              </div>
              {s.reasons.length > 0 && (
                <div>
                  <span style={{ color: 'var(--yes)' }}>+</span> {s.reasons.join(' · ')}
                </div>
              )}
              {s.tradeoffs.length > 0 && (
                <div>
                  <span style={{ color: 'var(--kinda)' }}>~</span> {s.tradeoffs.join(' · ')}
                </div>
              )}
              {s.missingData.length > 0 && (
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>?</span>{' '}
                  {s.missingData.join(' · ')}
                </div>
              )}
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}

// ── Evaluation panel ─────────────────────────────────────────

function EvaluationPanel({ evaluation }: { evaluation: Evaluation }) {
  const [open, setOpen] = useState(false)
  const verdictColor = evaluation.pass ? 'var(--yes)' : 'var(--no)'
  return (
    <Collapsible
      open={open}
      onToggle={() => setOpen((v) => !v)}
      title="Evaluation"
      meta={`${evaluation.pass ? 'PASS' : 'FAIL'} · quality ${evaluation.qualityScore}/10`}
      metaColor={verdictColor}
    >
      <div className="space-y-2 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
        {evaluation.missedConstraints.length > 0 && (
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Missed constraints:</span>{' '}
            {evaluation.missedConstraints.join(' · ')}
          </div>
        )}
        {evaluation.missingData.length > 0 && (
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Unverified data:</span>{' '}
            {evaluation.missingData.join(' · ')}
          </div>
        )}
        {evaluation.suggestedImprovement && (
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Suggested improvement:</span>{' '}
            {evaluation.suggestedImprovement}
          </div>
        )}
        {evaluation.missedConstraints.length === 0 &&
          evaluation.missingData.length === 0 &&
          !evaluation.suggestedImprovement && (
            <div style={{ color: 'var(--text-muted)' }}>
              No issues flagged.
            </div>
          )}
      </div>
    </Collapsible>
  )
}

// ── Logs panel ───────────────────────────────────────────────

function LogsPanel({ run }: { run: AgentRun }) {
  const [open, setOpen] = useState(false)
  const logs = useMemo(() => buildLogs(run), [run])
  return (
    <Collapsible
      open={open}
      onToggle={() => setOpen((v) => !v)}
      title="Operational Logs"
      meta={`runId ${run.runId.slice(0, 8)}… · ${logs.length} entries`}
    >
      <pre
        className="text-[11px] leading-relaxed p-3 rounded-lg overflow-x-auto"
        style={{
          backgroundColor: 'var(--surface-2)',
          color: 'var(--text-secondary)',
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        }}
      >
        {logs.join('\n')}
      </pre>
    </Collapsible>
  )
}

function buildLogs(run: AgentRun): string[] {
  const lines: string[] = []
  lines.push(`[${run.startedAt}] run.start runId=${run.runId}`)
  lines.push(`[${run.startedAt}] query=${JSON.stringify(run.query)}`)
  for (const ev of run.trace) {
    const llmPart = ev.llm
      ? ` model=${ev.llm.model} in=${ev.llm.inputTokens} out=${ev.llm.outputTokens} cost=$${ev.llm.estimatedCostUsd.toFixed(6)}`
      : ''
    const errPart = ev.errorMessage ? ` error=${JSON.stringify(ev.errorMessage)}` : ''
    lines.push(
      `[${ev.startedAt}] stage=${ev.stage} ok=${ev.ok} ms=${ev.durationMs}${llmPart}${errPart}`
    )
  }
  lines.push(
    `[end] totalMs=${run.totalDurationMs} totalCost=$${run.totalCostUsd.toFixed(6)} fatal=${run.fatal}`
  )
  if (run.fatalMessage) lines.push(`[end] fatalMessage=${JSON.stringify(run.fatalMessage)}`)
  return lines
}

// ── Shared primitives ────────────────────────────────────────

function Collapsible({
  open,
  onToggle,
  title,
  meta,
  metaColor,
  children,
}: {
  open: boolean
  onToggle: () => void
  title: string
  meta?: string
  metaColor?: string
  children: React.ReactNode
}) {
  return (
    <section
      className="rounded-xl border"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <ChevronRight
          size={14}
          style={{
            color: 'var(--text-muted)',
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.15s',
          }}
        />
        <span
          className="font-semibold text-sm"
          style={{ color: 'var(--text-primary)' }}
        >
          {title}
        </span>
        {meta && (
          <span
            className="ml-auto text-[11px] font-medium"
            style={{ color: metaColor ?? 'var(--text-muted)' }}
          >
            {meta}
          </span>
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          {children}
        </div>
      )}
    </section>
  )
}

function Json({ value }: { value: unknown }) {
  return (
    <pre
      className="text-[11px] mt-2 p-2 rounded-md overflow-x-auto"
      style={{
        backgroundColor: 'var(--surface-2)',
        color: 'var(--text-secondary)',
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

function SkeletonRun() {
  return (
    <div className="space-y-4 animate-pulse">
      <div
        className="rounded-xl border p-5 h-32"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
      />
      <div className="grid grid-cols-1 gap-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-lg border h-10"
            style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface)' }}
          />
        ))}
      </div>
    </div>
  )
}
