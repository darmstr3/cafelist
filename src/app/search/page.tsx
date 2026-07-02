'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import {
  InstantSearch, SearchBox, Hits, RefinementList,
  ToggleRefinement, Stats, Pagination, Configure,
} from 'react-instantsearch'
import { searchClient, ALGOLIA_INDEX, algoliaEnabled } from '@/lib/algolia'
import { SpotHit } from '@/components/search/SpotHit'

// FAILURE MODE / graceful degradation:
// This /search page is an ADDITIVE surface. The homepage keeps its Supabase
// query untouched, so if Algolia is ever unreachable, core browse still works
// — search is never a single point of failure for the site. When the flag is
// off (or Algolia isn't configured) we show a link back to the full list
// instead of a broken widget.
export default function SearchPage() {
  if (!algoliaEnabled || !searchClient) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-2xl font-bold">Search</h1>
        <p className="mt-2" style={{ color: 'var(--text-muted)' }}>
          Search isn&apos;t enabled here yet.{' '}
          <Link href="/" className="underline">Browse all spots →</Link>
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-8">
      <h1 className="mb-4 text-2xl font-bold">Search cafés</h1>
      {/* insights=true streams click/convert events → Search Analytics, which
          feeds CafeList's coverage-gap decisions (what people search + can't find). */}
      <InstantSearch searchClient={searchClient} indexName={ALGOLIA_INDEX} insights>
        <Configure hitsPerPage={24} />
        <SearchBox placeholder="Try “quiet wifi west village” or a café name…" />

        <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-[220px_1fr]">
          <aside className="space-y-5">
            <Facet title="Neighborhood">
              <RefinementList attribute="neighborhood" searchable limit={8} showMore />
            </Facet>
            <Facet title="Amenities">
              <ToggleRefinement attribute="has_wifi" label="Wi-Fi" />
              <ToggleRefinement attribute="has_outlets" label="Outlets" />
              <ToggleRefinement attribute="laptop_friendly" label="Laptop-friendly" />
            </Facet>
            <Facet title="Workability">
              <RefinementList attribute="workability_band" />
            </Facet>
          </aside>

          <section>
            <Stats />
            <Hits
              hitComponent={SpotHit}
              classNames={{ list: 'mt-3 grid grid-cols-2 gap-4 lg:grid-cols-3' }}
            />
            <div className="mt-6 flex justify-center">
              <Pagination />
            </div>
          </section>
        </div>
      </InstantSearch>
    </main>
  )
}

function Facet({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {children}
    </div>
  )
}
