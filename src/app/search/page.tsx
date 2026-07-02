'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import {
  InstantSearch, SearchBox, Hits, RefinementList,
  ToggleRefinement, Stats, Pagination, Configure,
} from 'react-instantsearch'
import { searchClient, ALGOLIA_INDEX, algoliaEnabled } from '@/lib/algolia'
import { SpotHit } from '@/components/search/SpotHit'

// Scoped styling for Algolia's default widgets, mapped to the CafeList
// palette (globals.css tokens). Inlined to avoid global-CSS import rules;
// every rule is namespaced under .cafelist-search so nothing leaks.
const SEARCH_CSS = `
.cafelist-search .ais-SearchBox-form { position: relative; }
.cafelist-search .ais-SearchBox-input {
  width: 100%; padding: 12px 40px 12px 14px; font-size: 1rem;
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
}
.cafelist-search .ais-SearchBox-submit { display: none; }
.cafelist-search .ais-SearchBox-reset {
  position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
  background: transparent; border: none; padding: 0; cursor: pointer; display: flex;
}
.cafelist-search .ais-SearchBox-resetIcon { width: 11px; height: 11px; fill: var(--text-muted); }

.cafelist-search .ais-RefinementList-list,
.cafelist-search .ais-Pagination-list { list-style: none; margin: 0; padding: 0; }
.cafelist-search .ais-RefinementList-item { margin-bottom: 7px; }
.cafelist-search .ais-RefinementList-label,
.cafelist-search .ais-ToggleRefinement-label {
  display: flex; align-items: center; gap: 9px; font-size: 0.9rem;
  color: var(--text-secondary); cursor: pointer;
}
.cafelist-search input[type="checkbox"] {
  appearance: auto; width: 15px; height: 15px; flex: none; margin: 0;
  padding: 0; border-radius: 3px; background: transparent; accent-color: var(--accent);
}
.cafelist-search .ais-RefinementList-count {
  margin-left: auto; font-size: 0.72rem; color: var(--text-muted);
  background: var(--surface-2); border-radius: 10px; padding: 1px 8px; font-variant-numeric: tabular-nums;
}
.cafelist-search .ais-RefinementList-showMore {
  margin-top: 8px; background: none; border: none; padding: 0;
  color: var(--accent); font-size: 0.82rem; font-weight: 500; cursor: pointer;
}
.cafelist-search .ais-RefinementList-searchBox { margin-bottom: 10px; }
.cafelist-search .ais-Stats-text { color: var(--text-muted); font-size: 0.85rem; }

.cafelist-search .ais-Pagination-list { display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; }
.cafelist-search .ais-Pagination-link {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 34px; height: 34px; padding: 0 9px; border: 1px solid var(--border);
  border-radius: 8px; background: var(--surface); color: var(--text-primary);
  text-decoration: none; font-size: 0.85rem;
}
.cafelist-search .ais-Pagination-item--selected .ais-Pagination-link {
  background: var(--accent); color: #fff; border-color: var(--accent);
}
.cafelist-search .ais-Pagination-item--disabled .ais-Pagination-link { opacity: 0.35; pointer-events: none; }
`

// FAILURE MODE: /search is additive — the homepage keeps its Supabase query,
// so an Algolia outage never takes the site down. When the flag is off we
// link back to the full list instead of rendering a broken widget.
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
      <style dangerouslySetInnerHTML={{ __html: SEARCH_CSS }} />
      <h1 className="mb-1 text-2xl font-bold">Search cafés</h1>
      <p className="mb-4 text-sm" style={{ color: 'var(--text-muted)' }}>
        Typo-tolerant, ranked by workability. Try “quiet wifi west village”.
      </p>
      <div className="cafelist-search">
        {/* insights streams click events → Search Analytics (coverage signal). */}
        <InstantSearch searchClient={searchClient} indexName={ALGOLIA_INDEX} insights>
          <Configure hitsPerPage={24} />
          <SearchBox placeholder="Search cafés, neighborhoods, vibes…" />

          <div className="mt-5 grid grid-cols-1 gap-8 md:grid-cols-[220px_1fr]">
            <aside className="space-y-6">
              <Facet title="Neighborhood">
                <RefinementList attribute="neighborhood" searchable limit={8} showMore />
              </Facet>
              <Facet title="Amenities">
                <div className="space-y-1.5">
                  <ToggleRefinement attribute="has_wifi" label="Wi-Fi" />
                  <ToggleRefinement attribute="has_outlets" label="Outlets" />
                  <ToggleRefinement attribute="laptop_friendly" label="Laptop-friendly" />
                </div>
              </Facet>
              <Facet title="Workability">
                <RefinementList attribute="workability_band" />
              </Facet>
            </aside>

            <section>
              <div className="mb-3">
                <Stats />
              </div>
              <Hits
                hitComponent={SpotHit}
                classNames={{ list: 'grid grid-cols-2 gap-4 lg:grid-cols-3' }}
              />
              <div className="mt-8">
                <Pagination />
              </div>
            </section>
          </div>
        </InstantSearch>
      </div>
    </main>
  )
}

function Facet({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        {title}
      </h3>
      {children}
    </div>
  )
}
