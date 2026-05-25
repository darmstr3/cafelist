// ─────────────────────────────────────────────────────────────
// Cafe retriever — pulls candidate spots from the live database
// (via the existing getSpots() helper), with the DEMO_SPOTS dataset
// as a fallback when Supabase is down or unconfigured. This mirrors
// the homepage's resilience model so the demo doesn't go dark when
// the Cloudflare→Supabase data plane has a hiccup.
//
// The retriever applies cheap, deterministic narrowing only — full
// fit ranking happens in the scorer. The goal here is to hand the
// scorer a sensible ~20-cafe shortlist instead of the whole table.
// ─────────────────────────────────────────────────────────────

import { getSpots } from '@/lib/spots'
import { DEMO_SPOTS } from '@/lib/demo-data'
import type { Spot, SpotFilters } from '@/types'
import type { ParsedIntent, RetrievalResult } from './types'
import { isNeighborhoodInBorough, isBorough } from './geo'

// True when Supabase is configured with real credentials. Mirrors
// the check in lib/spots so we can label trace output accurately.
function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return url.length > 0 && !url.includes('placeholder')
}

const MAX_CANDIDATES = 20

// Curator-driven filtering. The Curator Agent scores every spot 0–10 for
// "can a remote worker camp here 2+ hrs without pressure to leave". We trust
// that signal more than the review-derived work_score because review averages
// over-rate restaurants/bars (people rate the food highly even when they'd
// never actually camp there).
//
// WORKABILITY_STRICT_MIN: the default cutoff. Excludes restaurant-style
// entries by design.
// WORKABILITY_RELAXED_MIN: fallback when strict mode leaves nothing — better
// to surface a "best-of-the-mediocre" set than an empty page.
//
// Rows with NULL workability_score (unscored Scout rows in the 0–24h window
// before the daily curator catches them) are EXCLUDED from the strict pass
// but INCLUDED in the relaxed pass — the relaxed pass is already a softer
// promise to the user, so admitting unscored data there is acceptable.
const WORKABILITY_STRICT_MIN = 6
const WORKABILITY_RELAXED_MIN = 4

export async function retrieveCafes(intent: ParsedIntent): Promise<RetrievalResult> {
  const filtersApplied: string[] = []

  // Build the cheapest possible DB filter from the intent. We are
  // deliberately permissive — better to over-fetch and let the
  // scorer reason about tradeoffs than to filter out a 95% match
  // because of one missing flag.
  const filters: Partial<SpotFilters> = {}
  if (intent.city) {
    filters.city = intent.city
    filtersApplied.push(`city=${intent.city}`)
  }

  let spots: Spot[] = []
  // Honest labelling: getSpots() itself silently serves DEMO_SPOTS
  // when Supabase isn't configured, so we have to mirror its check
  // to know which source actually answered.
  let source: 'supabase' | 'demo' = isSupabaseConfigured() ? 'supabase' : 'demo'

  try {
    const result = await getSpots(filters)
    if (result.serviceError) {
      // Mirror the homepage's fallback strategy.
      spots = DEMO_SPOTS
      source = 'demo'
      filtersApplied.push('supabase-error→demo-fallback')
    } else {
      spots = result.spots
    }
  } catch {
    spots = DEMO_SPOTS
    source = 'demo'
    filtersApplied.push('supabase-throw→demo-fallback')
  }

  // If we got nothing back (e.g. city not in DB), fall back to the
  // full demo dataset so the agent still has something to reason
  // about. Better an honest "best-of-a-thin-set" answer than no
  // answer at all.
  if (spots.length === 0) {
    spots = source === 'supabase' ? DEMO_SPOTS : spots
    source = 'demo'
    filtersApplied.push('empty-result→demo-fallback')
  }

  const totalSearched = spots.length

  // Lightweight client-side narrowing for fields getSpots() doesn't
  // accept as filters. Always preserve cafes the user might still
  // want — e.g. someone asking for "Manhattan" still wants other
  // NYC neighborhoods as backups.
  let candidates = spots

  if (intent.neighborhood) {
    const needle = intent.neighborhood.toLowerCase()
    const boroughMode = isBorough(intent.neighborhood)
    const hits = candidates.filter((s) => {
      if (boroughMode && isNeighborhoodInBorough(intent.neighborhood!, s.neighborhood)) {
        return true
      }
      return (
        (s.neighborhood ?? '').toLowerCase().includes(needle) ||
        // "Manhattan" doesn't appear in the neighborhood field, but
        // some addresses include it; keep this as a backstop.
        s.address.toLowerCase().includes(needle)
      )
    })
    if (hits.length > 0) {
      candidates = hits
      filtersApplied.push(
        boroughMode ? `borough=${intent.neighborhood}` : `neighborhood~${intent.neighborhood}`
      )
    } else {
      // Neighborhood was specified but matched nothing in the candidate
      // set. We used to silently keep the unfiltered list here, which
      // caused the picker to return cafes from completely different
      // cities (West Village → Austin / Chicago). That's worse than no
      // result — the user thinks the filter worked when it didn't.
      //
      // New behavior: when a city is also known, narrow to spots in
      // that city as a near-miss fallback. When the city is also
      // unknown, return an empty candidate list and let the route
      // surface "no matches" honestly.
      if (intent.city) {
        const cityNeedle = intent.city.toLowerCase()
        const cityHits = candidates.filter((s) =>
          (s.city ?? '').toLowerCase().includes(cityNeedle)
        )
        candidates = cityHits
        filtersApplied.push(
          `neighborhood~${intent.neighborhood}-zero→fallback-to-city=${intent.city}`
        )
      } else {
        candidates = []
        filtersApplied.push(
          `neighborhood~${intent.neighborhood}-zero-no-city-no-fallback`
        )
      }
    }
  }

  // Type preference — if the user explicitly asked for libraries or
  // hotel lobbies etc., respect that. If their preferred type
  // matches no cafes, fall back to all types.
  if (intent.preferredTypes.length > 0) {
    const set = new Set(intent.preferredTypes)
    const hits = candidates.filter((s) => set.has(s.type))
    if (hits.length > 0) {
      candidates = hits
      filtersApplied.push(`type∈{${intent.preferredTypes.join(',')}}`)
    }
  }

  // Workability filter (Curator Agent). Two-stage with graceful loosening:
  //  1. Strict: workability_score >= 6, scored rows only.
  //  2. If strict empties the set, widen to >= 4 AND allow unscored rows,
  //     and note the loosening in filtersApplied so the trace UI can show
  //     "we relaxed the workability cutoff because no spots passed".
  // We deliberately keep this AFTER the location/type filters — applying
  // workability first could mask the fact that we have no candidates in
  // the requested area at all.
  const strict = candidates.filter(
    (s) => s.workability_score !== null && s.workability_score !== undefined && s.workability_score >= WORKABILITY_STRICT_MIN
  )
  if (strict.length > 0) {
    candidates = strict
    filtersApplied.push(`workability≥${WORKABILITY_STRICT_MIN}`)
  } else {
    const relaxed = candidates.filter(
      (s) =>
        s.workability_score === null ||
        s.workability_score === undefined ||
        s.workability_score >= WORKABILITY_RELAXED_MIN
    )
    if (relaxed.length > 0) {
      candidates = relaxed
      filtersApplied.push(
        `workability≥${WORKABILITY_RELAXED_MIN}-loosened-from-${WORKABILITY_STRICT_MIN}-zero-candidates`
      )
    } else {
      // Even the relaxed filter left nothing — drop the workability filter
      // entirely rather than show an empty page. The trace event tells the
      // user we did this so the answer is honestly framed.
      filtersApplied.push('workability-filter-dropped-zero-candidates-even-relaxed')
    }
  }

  // Rank by workability_score first (Curator-driven), falling back to
  // work_score when workability is null. The Curator score is a better
  // signal of "would you actually want to be here" than the review average.
  candidates = [...candidates]
    .sort((a, b) => {
      const aw = a.workability_score ?? -1
      const bw = b.workability_score ?? -1
      if (bw !== aw) return bw - aw
      return b.work_score - a.work_score
    })
    .slice(0, MAX_CANDIDATES)

  return {
    candidates,
    totalSearched,
    source,
    filtersApplied,
  }
}
