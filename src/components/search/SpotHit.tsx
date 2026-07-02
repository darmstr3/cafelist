'use client'

import Link from 'next/link'
import { Highlight } from 'react-instantsearch'
import type { Hit } from 'instantsearch.js'
import { SpotCardImage } from '../SpotCardImage'
import type { SpotRecord } from '@/lib/algolia'

// A search result rendered ENTIRELY from the Algolia record — no DB round-trip
// per hit. That's the instant-search pattern: index the fields you display so
// results paint the moment they return. <Highlight> shows Algolia's matched
// terms (incl. typo corrections) so the user sees *why* a result matched.
export function SpotHit({ hit }: { hit: Hit<SpotRecord> }) {
  const score = hit.workability_score
  return (
    <Link
      href={`/spot/${hit.slug}`}
      className="block overflow-hidden rounded-xl border transition-shadow hover:shadow-md"
      style={{ borderColor: 'var(--border, #e7e1d8)' }}
    >
      <div className="relative aspect-[4/3]" style={{ background: 'var(--surface-2, #ece5da)' }}>
        <SpotCardImage src={hit.cover_photo} alt={hit.name} />
      </div>
      <div className="p-3">
        <h3 className="text-base font-semibold leading-tight">
          <Highlight attribute="name" hit={hit} />
        </h3>
        {hit.neighborhood && (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{hit.neighborhood}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {typeof score === 'number' && (
            <span className="rounded px-1.5 py-0.5 font-medium" style={{ background: 'var(--accent-soft, #e7f0e7)' }}>
              {score.toFixed(1)}/10
            </span>
          )}
          {hit.has_wifi && <span className="rounded border px-1.5 py-0.5" style={{ borderColor: 'var(--border, #e7e1d8)' }}>Wi-Fi</span>}
          {hit.has_outlets && <span className="rounded border px-1.5 py-0.5" style={{ borderColor: 'var(--border, #e7e1d8)' }}>Outlets</span>}
        </div>
      </div>
    </Link>
  )
}
