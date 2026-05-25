'use client'

// ─────────────────────────────────────────────────────────────
// /labs experience — V2 (mode picker).
//
// Thin client wrapper around <ModePicker /> that owns submission to
// /api/labs/recommend. The picker stays presentational; this file
// is where state lives that crosses the network boundary.
//
// Until ticket #9 (result card v2) lands, the post-submit UI is the
// shared RecommendationCard plus an error block. This satisfies ticket
// #5's acceptance criterion ("submit triggers /api/labs/recommend with
// payload { mode, modifiers, modeFreeform?, location, weekday }")
// without needing the server-side payload handling that lives in
// ticket #7.
//
// Top-bar pattern intentionally mirrors LabsExperience so the V2
// surface feels like one product with V1 — same wordmark, same
// "Labs" badge, same Back link. The editorial hero (serif headline,
// copper "Concierge" eyebrow) is the V2 visual differentiator.
//
// See LABS_V2_PLAN.md §2, §8 ticket #5.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import {
  ModePicker,
  type ModePickerSubmitPayload,
} from '@/components/labs/ModePicker'
import { RecommendationCard } from '@/components/labs/RecommendationCard'
import type { AgentRun, RetrievalResult } from '@/lib/labs/types'

// Pull the retriever's `source` out of the trace so the UI can warn
// when we're serving DEMO_SPOTS. The retriever stage's output is a
// RetrievalResult — typed loosely as `unknown` on TraceEvent so each
// stage can own its own shape. We narrow defensively here.
function retrievalSource(run: AgentRun | undefined): 'supabase' | 'demo' | null {
  if (!run) return null
  const ev = run.trace.find((e) => e.stage === 'retriever')
  if (!ev || typeof ev.output !== 'object' || ev.output === null) return null
  const out = ev.output as Partial<RetrievalResult>
  return out.source === 'supabase' || out.source === 'demo' ? out.source : null
}

// Local weekday. Server-side handling (ticket #7) will read this to
// resolve hours/open_after constraints. JSON-friendly lowercase
// names mirror the existing DAY_NAMES convention elsewhere in the
// codebase (see CafeModal).
const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const

interface SubmittedRun {
  payload: ModePickerSubmitPayload & { weekday: string }
  /** Successful response from /api/labs/recommend — an AgentRun.
   *  Set only when the HTTP request succeeded; on error, `error` is set
   *  and this is left undefined. */
  response?: AgentRun
  error?: string
}

export function LabsV2Experience() {
  const [submitting, setSubmitting] = useState(false)
  const [run, setRun] = useState<SubmittedRun | null>(null)
  // Anchor for scroll-into-view after a submit completes. Without
  // this, the result card renders below the (tall) picker and users
  // don't realize there's an answer waiting for them.
  const resultRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!submitting && run && resultRef.current) {
      // Defer one frame so the layout has stabilized after the new
      // card renders, then scroll the result into view.
      requestAnimationFrame(() => {
        resultRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        })
      })
    }
  }, [submitting, run])

  async function handleSubmit(p: ModePickerSubmitPayload) {
    const weekday = WEEKDAYS[new Date().getDay()]
    const payload = { ...p, weekday }

    setSubmitting(true)
    setRun({ payload })

    try {
      const res = await fetch('/api/labs/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const errMsg =
          typeof body === 'object' && body && 'error' in body
            ? String((body as { error: unknown }).error)
            : `HTTP ${res.status}`
        setRun({ payload, error: errMsg })
      } else {
        // The route returns 200 even on fatal errors so the client
        // can render a partial trace; surface the fatal message as an
        // error here so we don't show a half-empty result card.
        const run = body as AgentRun
        if (run.fatal) {
          setRun({
            payload,
            response: run,
            error: run.fatalMessage ?? 'The agent hit an error mid-run.',
          })
        } else {
          setRun({ payload, response: run })
        }
      }
    } catch (e) {
      setRun({
        payload,
        error: e instanceof Error ? e.message : 'Unknown error',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* ── Top bar (mirrors LabsExperience) ─────────────────── */}
      <div
        className="sticky top-0 z-20 border-b"
        style={{
          backgroundColor: 'var(--background)',
          borderColor: 'var(--border-subtle)',
        }}
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
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

      <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-10 sm:pt-14 pb-20 space-y-14">
        {/* ── Hero ─────────────────────────────────────────────
            Editorial display headline with an italic copper accent
            on the verb "matches" — the brand promise in one line.
            Subhead explains the methodology in plain English so a
            first-time visitor knows what the agent is doing. */}
        <header className="space-y-5">
          <div
            className="text-[11px] uppercase tracking-[0.22em] font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            Concierge
          </div>
          <h1
            className="text-[40px] leading-[1.02] sm:text-5xl md:text-6xl tracking-tight"
            style={{
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-fraunces)',
              fontWeight: 600,
              letterSpacing: '-0.025em',
            }}
          >
            Find a café that{' '}
            <em
              style={{
                color: 'var(--accent)',
                fontStyle: 'italic',
                fontWeight: 600,
              }}
            >
              matches
            </em>{' '}
            what you&apos;re trying to do.
          </h1>
          <p
            className="text-base sm:text-[17px] leading-relaxed max-w-xl"
            style={{ color: 'var(--text-secondary)' }}
          >
            Tell us the intent — we weigh hours, outlets, noise, light, vibe, and
            seating against thousands of café notes, then explain the tradeoff
            in plain English.
          </p>
        </header>

        <ModePicker onSubmit={handleSubmit} submitting={submitting} />

        {/* ── Post-submit result ───────────────────────────────
            Mirrors V1's render: error block when something went wrong,
            otherwise the shared RecommendationCard. Trace/evaluation
            panels are deferred to a follow-up ticket — the recommendation
            itself is what users came for.

            We surface the retrieval `source` here so it's obvious when
            the deploy is serving DEMO_SPOTS instead of the live DB —
            this was previously silent and produced bizarre recs (a
            hardcoded "The Late Lobby" in Midtown for a West Village
            query). The banner is the user-facing signal; the env-var
            fix is operational. */}
        {run && (
          <div ref={resultRef} className="space-y-4 fade-in scroll-mt-20">
            {retrievalSource(run.response) === 'demo' && !run.error && (
              <section
                className="rounded-2xl border p-4 text-sm"
                style={{
                  backgroundColor: 'rgba(198, 133, 18, 0.10)',
                  borderColor: 'var(--kinda)',
                  color: 'var(--text-primary)',
                }}
              >
                <div
                  className="font-semibold mb-1"
                  style={{ color: 'var(--kinda)' }}
                >
                  Showing demo data — not the live directory
                </div>
                <div style={{ color: 'var(--text-secondary)' }}>
                  This deployment is falling back to a built-in sample set
                  because Supabase isn&apos;t connected. Recommendations
                  below are from <code>src/lib/demo-data.ts</code> and
                  don&apos;t reflect real coverage. Set
                  <code> NEXT_PUBLIC_SUPABASE_URL</code> +{' '}
                  <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> for the
                  Preview environment in Vercel.
                </div>
              </section>
            )}

            {run.error && (
              <section
                className="rounded-2xl border p-4 text-sm"
                style={{
                  backgroundColor: 'rgba(168, 57, 47, 0.08)',
                  borderColor: 'var(--no)',
                  color: 'var(--no)',
                }}
              >
                <div className="font-semibold mb-1">
                  Something went wrong
                </div>
                <div>{run.error}</div>
              </section>
            )}

            {run.response?.recommendation && !run.error && (
              <RecommendationCard rec={run.response.recommendation} />
            )}

            {run.response && !run.response.recommendation && !run.error && (
              <section
                className="rounded-2xl border p-4 text-sm"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--text-secondary)',
                }}
              >
                The agent ran but didn&apos;t find any cafés matching that
                combination. Try widening the neighborhood or removing a
                modifier.
              </section>
            )}
          </div>
        )}
      </div>
    </>
  )
}
