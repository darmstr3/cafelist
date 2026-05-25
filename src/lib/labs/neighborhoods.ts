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
  /** What we send to the API (matches the spots.neighborhood string). */
  value: string
  /** What we show on the chip. Usually same as value, but prefixed
   *  with a city tag when ambiguous (e.g. "Capitol Hill" exists in
   *  both Seattle and DC). */
  label: string
}

export const POPULAR_NEIGHBORHOODS: NeighborhoodChip[] = [
  // NYC — launch city, top of the list.
  { value: 'East Village', label: 'East Village' },
  { value: 'West Village', label: 'West Village' },
  { value: 'Greenwich Village', label: 'Greenwich Village' },
  { value: 'Williamsburg', label: 'Williamsburg' },
  { value: 'Bushwick', label: 'Bushwick' },
  { value: 'Midtown', label: 'Midtown' },
  { value: 'Financial District', label: 'FiDi' },
  { value: 'SoHo', label: 'SoHo' },
  // Secondary cities.
  { value: 'SoMa', label: 'SoMa (SF)' },
  { value: 'Silver Lake', label: 'Silver Lake (LA)' },
  { value: 'Wicker Park', label: 'Wicker Park (CHI)' },
  { value: 'East Austin', label: 'East Austin' },
]
