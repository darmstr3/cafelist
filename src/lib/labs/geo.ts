// ─────────────────────────────────────────────────────────────
// Geographic helpers — borough → neighborhood awareness.
//
// Users routinely say "Manhattan" or "Brooklyn" when they mean any
// neighborhood inside that borough, so naive substring matching
// mishandles correctly-labelled spots ("Midtown is not Manhattan"
// — yes it is). This module centralises that knowledge so both the
// retriever (narrowing candidate set) and the fit scorer (ranking)
// agree on what counts as a match.
//
// Anything not in this table falls back to substring matching by
// the caller, so adding a new city is purely additive.
// ─────────────────────────────────────────────────────────────

export const BOROUGH_NEIGHBORHOODS: Record<string, string[]> = {
  manhattan: [
    'midtown', 'midtown east', 'midtown west', 'times square',
    'upper east side', 'upper west side', 'harlem', 'east harlem',
    'washington heights', 'inwood', 'morningside heights',
    'hells kitchen', "hell's kitchen", 'chelsea', 'flatiron',
    'gramercy', 'union square', 'east village', 'west village',
    'greenwich village', 'soho', 'noho', 'nolita', 'tribeca',
    'lower east side', 'two bridges', 'chinatown', 'little italy',
    'financial district', 'fidi', 'battery park city', 'wall street',
    'murray hill', 'kips bay', 'turtle bay', 'lenox hill',
    'yorkville', 'carnegie hill',
  ],
  brooklyn: [
    'williamsburg', 'greenpoint', 'bushwick', 'bed-stuy',
    'bedford-stuyvesant', 'crown heights', 'park slope',
    'prospect heights', 'fort greene', 'clinton hill', 'dumbo',
    'brooklyn heights', 'cobble hill', 'carroll gardens',
    'red hook', 'gowanus', 'sunset park', 'bay ridge',
    'bensonhurst', 'sheepshead bay', 'flatbush', 'ditmas park',
    'kensington', 'midwood', 'east new york', 'brownsville',
    'downtown brooklyn', 'boerum hill',
  ],
  queens: [
    'long island city', 'lic', 'astoria', 'sunnyside', 'woodside',
    'jackson heights', 'elmhurst', 'forest hills', 'rego park',
    'flushing', 'jamaica', 'ridgewood', 'maspeth',
  ],
  bronx: [
    'south bronx', 'mott haven', 'fordham', 'riverdale', 'belmont',
    'pelham bay', 'kingsbridge', 'morrisania',
  ],
  'the bronx': [
    'south bronx', 'mott haven', 'fordham', 'riverdale', 'belmont',
    'pelham bay', 'kingsbridge', 'morrisania',
  ],
}

/**
 * True when `spotNeighborhood` is a neighborhood within the borough
 * named by `intentNeighborhood`. Returns false for non-borough names
 * (e.g. "SoMa" isn't a borough), so callers fall back to substring
 * matching.
 */
export function isNeighborhoodInBorough(
  intentNeighborhood: string,
  spotNeighborhood: string | null
): boolean {
  if (!spotNeighborhood) return false
  const borough = intentNeighborhood.toLowerCase().trim()
  const list = BOROUGH_NEIGHBORHOODS[borough]
  if (!list) return false
  const n = spotNeighborhood.toLowerCase().trim()
  return list.some((sub) => n === sub || n.includes(sub))
}

/** True when the intent name refers to a known borough. */
export function isBorough(name: string): boolean {
  return name.toLowerCase().trim() in BOROUGH_NEIGHBORHOODS
}
