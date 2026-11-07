// ─────────────────────────────────────────────────────────────
// Workability tiers — single source of truth.
//
// Previously the tier thresholds (8 / 6 / 4) were duplicated between
// SpotCard.tsx (labels: "great" / "good" / "ok") and
// spot/[id]/page.tsx (labels: "Great for working" / "Workable" /
// "Workable with friction"). Same cutoffs, different words — a spot
// could read "good" on the grid and "Workable" on its own page.
// This is the one place that owns the score→tier mapping so the
// grid, the detail hero, and the "today's pick" module all agree.
//
// Thresholds are unchanged from the original UX-review pass — only
// the presentation (badge weight, consistent wording) changes here.
// ─────────────────────────────────────────────────────────────

export type WorkabilityTierKey = 'great' | 'good' | 'ok'

export interface WorkabilityTier {
  key: WorkabilityTierKey
  /** Full sentence-style label, used on the detail hero. */
  label: string
  /** Short word, used on cards where space is tight. */
  short: string
  color: string
  bg: string
  bgStrong: string
  ring: string
}

export const WORKABILITY_TIERS: Record<WorkabilityTierKey, WorkabilityTier> = {
  great: {
    key: 'great',
    label: 'Great for working',
    short: 'Great',
    color: 'var(--yes)',
    bg: 'rgba(47,125,79,0.10)',
    bgStrong: 'rgba(47,125,79,0.20)',
    ring: 'rgba(47,125,79,0.38)',
  },
  good: {
    key: 'good',
    label: 'Workable',
    short: 'Good',
    color: 'var(--yes)',
    bg: 'rgba(47,125,79,0.07)',
    bgStrong: 'rgba(47,125,79,0.13)',
    ring: 'rgba(47,125,79,0.26)',
  },
  ok: {
    key: 'ok',
    label: 'Workable with friction',
    short: 'OK',
    color: 'var(--kinda)',
    bg: 'rgba(198,133,18,0.08)',
    bgStrong: 'rgba(198,133,18,0.16)',
    ring: 'rgba(198,133,18,0.32)',
  },
}

/** Same cutoffs as the pre-existing workabilityChip / workabilityLabel logic. */
export function workabilityTierForScore(score: number): WorkabilityTier | null {
  if (score >= 8) return WORKABILITY_TIERS.great
  if (score >= 6) return WORKABILITY_TIERS.good
  if (score >= 4) return WORKABILITY_TIERS.ok
  return null // low scores stay unadvertised, same as before
}
