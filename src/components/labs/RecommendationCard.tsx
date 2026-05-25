// ─────────────────────────────────────────────────────────────
// RecommendationCard — shared result card for the /labs surface.
//
// Renders the final Recommendation produced by the agent pipeline.
// We deliberately omit confidence / caveats from the user-facing
// output (May 25 product call: "no one cares about low confidence
// results"). The agent still computes them and the trace UI / eval
// harness still reads them — they're just hidden from the surface
// the user reads. If a recommendation is genuinely bad the path is
// to return fewer picks, not to label them with apology copy.
//
// Picks link out to Google Maps (gmapsQuery → /maps/search). Users
// asking "find me a café" want directions, not another in-app
// screen — opening Maps in a new tab matches the actual job.
// ─────────────────────────────────────────────────────────────

import { ExternalLink } from 'lucide-react'
import type { Recommendation, RecommendationPick } from '@/lib/labs/types'

function gmapsHref(p: RecommendationPick): string {
  // Always linkable: fall back to spotName if the route didn't attach
  // a gmapsQuery (older fixtures, eval harness, etc.). encodeURIComponent
  // handles spaces, commas, and apostrophes for café names like
  // "Hell's Kitchen Coffee."
  const q = p.gmapsQuery ?? p.spotName
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
}

export function RecommendationCard({ rec }: { rec: Recommendation }) {
  return (
    <div
      className="rounded-2xl border p-5 space-y-5"
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
            className="flex gap-3 p-3 rounded-xl"
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
            <div className="space-y-1 min-w-0 flex-1">
              <div className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                <a
                  href={gmapsHref(p)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 transition-opacity hover:opacity-70"
                >
                  {p.spotName}
                  <ExternalLink size={11} aria-hidden="true" />
                </a>
              </div>
              <div className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {p.oneLiner}
              </div>
              <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                {p.tradeoff}
              </div>
            </div>
          </li>
        ))}
      </ol>

      {rec.backup && (
        <div
          className="text-sm p-3 rounded-xl border"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
        >
          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            Backup:
          </span>{' '}
          <a
            href={gmapsHref(rec.backup)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium inline-flex items-center gap-1 transition-opacity hover:opacity-70"
            style={{ color: 'var(--text-primary)' }}
          >
            {rec.backup.spotName}
            <ExternalLink size={11} aria-hidden="true" />
          </a>{' '}
          — {rec.backup.oneLiner}
        </div>
      )}
    </div>
  )
}
