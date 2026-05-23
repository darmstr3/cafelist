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
  /** Raw response body — could be the eventual AgentRun once #7 ships,
   *  or an error JSON in the meantime. We render the JSON in a
   *  read-only block. */
  response?: unknown
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
        setRun({ payload, response: body, error: errMsg })
      } else {
        setRun({ payload, response: body })
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

        {/* ── Post-submit placeholder ──────────────────────────
            Becomes the real result card stack in ticket #9. For
            now: show the payload we sent + the server's response so
            we can verify shape end-to-end during the demo, and so a
            recruiter watching the Loom can see "the picker really
            does send a structured payload." */}
        {run && (
          <section
            className="rounded-2xl border p-5 fade-in"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
              <h2
                className="text-sm font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                Submitted — payload preview
              </h2>
              <span
                className="text-[10px] uppercase tracking-wider"
                style={{ color: 'var(--text-muted)' }}
              >
                Result cards land in ticket #9
              </span>
            </div>

            <pre
              className="text-[12px] leading-relaxed overflow-x-auto rounded-lg p-3 mb-3"
              style={{
                backgroundColor: 'var(--surface-2)',
                color: 'var(--text-secondary)',
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
              }}
            >
              {JSON.stringify(run.payload, null, 2)}
            </pre>

            {run.error && (
              <div
                className="text-xs rounded-lg p-3 mb-3 border"
                style={{
                  backgroundColor: 'rgba(168, 57, 47, 0.08)',
                  borderColor: 'var(--no)',
                  color: 'var(--no)',
                }}
              >
                <strong>Server response:</strong> {run.error}
                {/* Expected until ticket #7 wires the new payload path
                    through /api/labs/recommend. Not a regression. */}
                <div
                  className="mt-1 text-[11px]"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Expected until ticket #7 lands the server-side payload
                  handler.
                </div>
              </div>
            )}

            {run.response !== undefined && !run.error && (
              <pre
                className="text-[12px] leading-relaxed overflow-x-auto rounded-lg p-3"
                style={{
                  backgroundColor: 'var(--surface-2)',
                  color: 'var(--text-secondary)',
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
                  maxHeight: '320px',
                }}
              >
                {JSON.stringify(run.response, null, 2)}
              </pre>
            )}
          </section>
        )}
      </div>
    </>
  )
}
