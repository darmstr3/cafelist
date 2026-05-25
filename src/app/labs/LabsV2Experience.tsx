'use client'

// ─────────────────────────────────────────────────────────────
// /labs experience — V2 (mode picker).
//
// Thin client wrapper around <ModePicker /> that owns submission to
// /api/labs/recommend. The picker stays presentational; this file
// is where state lives that crosses the network boundary.
//
// Until ticket #9 (result card v2) lands, the post-submit UI is a
// payload preview + a placeholder note. This satisfies ticket #5's
// acceptance criterion ("submit triggers /api/labs/recommend with
// payload { mode, modifiers, modeFreeform?, location, weekday }")
// without needing the server-side payload handling that lives in
// ticket #7.
//
// Top-bar pattern intentionally mirrors LabsExperience so the V2
// surface feels like one product with V1 — same wordmark, same
// "Labs" badge, same Back link.
//
// See LABS_V2_PLAN.md §2, §8 ticket #5.
// ─────────────────────────────────────────────────────────────

import { useState } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import {
  ModePicker,
  type ModePickerSubmitPayload,
} from '@/components/labs/ModePicker'
import { RecommendationCard } from '@/components/labs/RecommendationCard'
import type { AgentRun } from '@/lib/labs/types'

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
        <ModePicker onSubmit={handleSubmit} submitting={submitting} />

        {/* ── Post-submit result ───────────────────────────────
            Mirrors V1's render: error block when something went wrong,
            otherwise the shared RecommendationCard. Trace/evaluation
            panels are deferred to a follow-up ticket — the recommendation
            itself is what users came for. */}
        {run && (
          <div className="space-y-4 fade-in">
            {run.error && (
              <section
                className="rounded-xl border p-4 text-sm"
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
                className="rounded-xl border p-4 text-sm"
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
