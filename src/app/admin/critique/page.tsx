// ─────────────────────────────────────────────────────────────
// /admin/critique — design feedback + reference library.
//
// Box-select feedback directly on mockup screenshots (markup.io-
// style), batched into named groups, queued for a Claude session
// to work through together. Paired with a small library of outside
// sites used as design benchmarks.
//
// This replaces the earlier Claude-Artifact version of this tool
// (Critique Desk) — living here means it's part of the actual
// cafelist admin, not a separate link to remember.
//
// Gated by the same /admin Basic Auth as every other admin route
// (src/middleware.ts — no extra auth code needed here).
// ─────────────────────────────────────────────────────────────

import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { CRITIQUE_FRAMES } from '@/lib/admin/critique-data'
import { listFeedback } from '@/lib/admin/critique-queries'
import { listReferences } from '@/lib/admin/reference-queries'
import CritiqueBoard from './CritiqueBoard'
import ReferenceLibrary from './ReferenceLibrary'

export const metadata = {
  title: 'Design Critique — Cafelist',
  description:
    'Box-select feedback on design mockups, grouped and queued for a Claude session to work through, plus a library of outside design references.',
}

export const dynamic = 'force-dynamic'

export default async function CritiquePage() {
  const [feedback, references] = await Promise.all([listFeedback(), listReferences()])

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
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
          <span
            className="ml-auto wordmark text-[15px] flex items-center gap-2"
            style={{ color: 'var(--text-primary)' }}
          >
            <span>Cafelist</span>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide"
              style={{ backgroundColor: 'var(--accent-glow)', color: 'var(--accent)' }}
            >
              Critique
            </span>
          </span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <header className="space-y-2">
          <h1
            className="text-2xl sm:text-3xl font-semibold tracking-tight"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-fraunces)' }}
          >
            Design critique
          </h1>
          <p className="text-sm leading-relaxed max-w-3xl" style={{ color: 'var(--text-secondary)' }}>
            Drag a box on anything that needs to change, type the fix, and it&rsquo;s logged. Select a
            batch of pending items and queue them together — a Claude session works through one
            group at a time rather than one subagent per tiny edit. Not fully unattended yet: queued
            items wait until a session is asked to process them.
          </p>
        </header>

        <section
          className="rounded-lg border p-5"
          style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface-1)' }}
        >
          <CritiqueBoard frames={CRITIQUE_FRAMES} initialFeedback={feedback} />
        </section>

        <ReferenceLibrary initial={references} />
      </div>
    </div>
  )
}
