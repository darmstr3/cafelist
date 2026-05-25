// ─────────────────────────────────────────────────────────────
// RecommendationCard — shared result card for the /labs surface.
//
// Renders the final Recommendation produced by the agent pipeline:
// a one-line summary, the ranked picks (with name + one-liner +
// honest tradeoff), an optional backup pick, and the confidence /
// caveats line at the bottom.
//
// Originally lived inline inside LabsExperience.tsx (V1 free-text).
// Extracted here so the V2 picker surface (LabsV2Experience) can
// render the same card without duplication. Visual language is
// unchanged from V1 — same warm-light palette, same Fraunces summary,
// same rounded card with numbered list — so a user moving between
// the two entry points sees a consistent result.
// ─────────────────────────────────────────────────────────────

import type { Recommendation } from '@/lib/labs/types'

export function RecommendationCard({ rec }: { rec: Recommendation }) {
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
