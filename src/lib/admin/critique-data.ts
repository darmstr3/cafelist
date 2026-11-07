// ─────────────────────────────────────────────────────────────
// src/lib/admin/critique-data.ts
//
// Static registry of design mockup screenshots available for
// box-annotation on /admin/critique. These are rendered mockups
// (not live app pages) — see public/critique/*.png.
//
// Adding a new iteration/frame to review: drop the PNG in
// public/critique/ and add an entry here. No migration needed —
// this list is code, the feedback rows are data.
// ─────────────────────────────────────────────────────────────

export interface CritiqueFrame {
  id: string
  project: string
  iterationLabel: string
  frameLabel: string
  imagePath: string
  /** Logical width/height the mockup was built at — used to size
   * the <img> so percent-based bbox coordinates line up. */
  width: number
  height: number
}

export const CRITIQUE_FRAMES: CritiqueFrame[] = [
  {
    id: 'a-venue',
    project: 'cafelist',
    iterationLabel: 'Directions A/B/C',
    frameLabel: 'A · Venue (mobile)',
    imagePath: '/critique/main-a-venue.png',
    width: 390,
    height: 2300,
  },
  {
    id: 'b-venue',
    project: 'cafelist',
    iterationLabel: 'Directions A/B/C',
    frameLabel: 'B · Venue (mobile)',
    imagePath: '/critique/b-venue.png',
    width: 390,
    height: 2060,
  },
  {
    id: 'c-venue',
    project: 'cafelist',
    iterationLabel: 'Directions A/B/C',
    frameLabel: 'C · Venue (mobile)',
    imagePath: '/critique/c-venue.png',
    width: 390,
    height: 2260,
  },
  {
    id: 'r-venue',
    project: 'cafelist',
    iterationLabel: 'Color fix pass',
    frameLabel: 'Venue (mobile)',
    imagePath: '/critique/r-venue-mobile.png',
    width: 390,
    height: 1920,
  },
  {
    id: 'r-home',
    project: 'cafelist',
    iterationLabel: 'Color fix pass',
    frameLabel: 'Homepage (mobile)',
    imagePath: '/critique/r-home-mobile.png',
    width: 390,
    height: 2720,
  },
  {
    id: 'r-astoria',
    project: 'cafelist',
    iterationLabel: 'Color fix pass',
    frameLabel: 'Astoria (mobile)',
    imagePath: '/critique/r-astoria-mobile.png',
    width: 390,
    height: 1820,
  },
  {
    id: 'r2-venue',
    project: 'cafelist',
    iterationLabel: 'Signature pass v2',
    frameLabel: 'Venue (mobile)',
    imagePath: '/critique/r2-venue-mobile.png',
    width: 390,
    height: 1740,
  },
]

export function getFrame(id: string): CritiqueFrame | undefined {
  return CRITIQUE_FRAMES.find((f) => f.id === id)
}
