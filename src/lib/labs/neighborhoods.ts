// ─────────────────────────────────────────────────────────────
// Popular-neighborhood seed list used by the V2 picker.
//
// Why hardcoded for now: the picker needs *something* tappable on
// first render. Fetching distinct neighborhoods from the spots table
// requires either a dedicated /api/labs/neighborhoods endpoint or
// loading the full spots payload client-side — neither is justified
// before we know whether users actually use the picker.
//
// This list is intentionally small (top tap-to-fill candidates per
// launch city) and pairs with a free-text input + <datalist> for
// anything off-list. When we ship a real "distinct neighborhoods"
// endpoint, the picker swaps this constant for the fetch result and
// the chip behavior is unchanged.
// ─────────────────────────────────────────────────────────────

export interface NeighborhoodChip {
  /** What we send to the API as the neighborhood (matches the
   *  spots.neighborhood string). */
  value: string
  /** What we show on the chip. Usually same as value, but prefixed
   *  with a city tag when ambiguous (e.g. "Capitol Hill" exists in
   *  both Seattle and DC). */
  label: string
  /** Inferred city for this neighborhood. The picker passes this
   *  along so the retriever can scope correctly — without it,
   *  picking "West Village" returned cafes from Austin and Chicago
   *  when the NYC DB had no exact "West Village" row. See the
   *  retriever's neighborhood fallback branch. */
  city: string
}

export const POPULAR_NEIGHBORHOODS: NeighborhoodChip[] = [
  // NYC — launch city, top of the list.
  { value: 'East Village', label: 'East Village', city: 'New York City' },
  { value: 'West Village', label: 'West Village', city: 'New York City' },
  { value: 'Greenwich Village', label: 'Greenwich Village', city: 'New York City' },
  { value: 'Williamsburg', label: 'Williamsburg', city: 'New York City' },
  { value: 'Bushwick', label: 'Bushwick', city: 'New York City' },
  { value: 'Midtown', label: 'Midtown', city: 'New York City' },
  { value: 'Financial District', label: 'FiDi', city: 'New York City' },
  { value: 'SoHo', label: 'SoHo', city: 'New York City' },
  // Secondary cities.
  { value: 'SoMa', label: 'SoMa (SF)', city: 'San Francisco' },
  { value: 'Silver Lake', label: 'Silver Lake (LA)', city: 'Los Angeles' },
  { value: 'Wicker Park', label: 'Wicker Park (CHI)', city: 'Chicago' },
  { value: 'East Austin', label: 'East Austin', city: 'Austin' },
]
