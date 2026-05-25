/**
 * Public /find ranker — deterministic filter + score per mode.
 *
 * Why deterministic (not LLM): /labs uses an LLM to write the
 * recommendation prose, which makes it slow and occasionally flaky.
 * The public /find surface needs to be snappy and reliable on every
 * load. It reuses the same MODES/MODIFIERS registry but skips the
 * LLM — the "why this fits" sentence is built from structured fields,
 * not generated.
 *
 * Inputs: ModeId + ModifierId[] + optional user location.
 * Outputs: ranked spot list with a one-line fit_reason per result.
 */

import type { Spot, NoiseLevel } from '@/types'
import { MODES, MODIFIERS, type ModeId, type ModifierId, type HardConstraints } from '@/lib/labs/modes'

export interface RankedSpot {
  spot: Spot
  fit_score: number
  fit_reason: string
  distance_meters?: number
}

interface RankOptions {
  mode: ModeId
  modifiers?: ModifierId[]
  origin?: { lat: number; lng: number }
  limit?: number
}

const NOISE_ORDER: Record<NoiseLevel, number> = {
  silent: 0,
  quiet: 1,
  moderate: 2,
  loud: 3,
}

/** Merge a mode's hard constraints with active modifiers' constraints.
 * Modifiers override scalars; arrays are unioned. Matches the rule in
 * intent-synthesizer.ts so /find and /labs stay semantically consistent. */
function mergeConstraints(
  mode: ModeId,
  modifiers: ModifierId[]
): HardConstraints {
  const base: HardConstraints = { ...MODES[mode].hardConstraints }
  const vibeSet = new Set(base.vibe ?? [])
  const avoidSet = new Set(base.avoid ?? [])

  for (const id of modifiers) {
    const m = MODIFIERS[id]
    if (!m?.hardConstraints) continue
    const c = m.hardConstraints

    // Scalar overrides
    if (c.noiseTolerance !== undefined) base.noiseTolerance = c.noiseTolerance
    if (c.needsOutlets !== undefined) base.needsOutlets = c.needsOutlets
    if (c.needsWifi !== undefined) base.needsWifi = c.needsWifi
    if (c.laptopFriendly !== undefined) base.laptopFriendly = c.laptopFriendly
    if (c.needsFood !== undefined) base.needsFood = c.needsFood
    if (c.openAfter !== undefined) base.openAfter = c.openAfter
    if (c.timeOfDay !== undefined) base.timeOfDay = c.timeOfDay
    if (c.preferredTypes !== undefined) base.preferredTypes = c.preferredTypes

    // Array unions
    for (const v of c.vibe ?? []) vibeSet.add(v)
    for (const v of c.avoid ?? []) avoidSet.add(v)
  }

  base.vibe = [...vibeSet]
  base.avoid = [...avoidSet]
  return base
}

function passesHardFilter(spot: Spot, c: HardConstraints): boolean {
  // Type filter (the hardest stop-the-bleeding lever per modes.ts comment)
  if (c.preferredTypes && c.preferredTypes.length > 0) {
    if (!c.preferredTypes.includes(spot.type)) return false
  }
  // Feature requirements — only filter when explicitly required
  if (c.needsWifi && !spot.has_wifi) return false
  if (c.laptopFriendly && !spot.laptop_friendly) return false
  if (c.needsOutlets && !spot.has_outlets) return false
  if (c.needsFood && !spot.has_food) return false

  // Noise tolerance: spot must be AT OR QUIETER than the tolerance
  if (c.noiseTolerance && spot.noise_level) {
    const allowed = NOISE_ORDER[c.noiseTolerance]
    const actual = NOISE_ORDER[spot.noise_level]
    if (actual > allowed) return false
  }

  // Avoid list — penalize venues whose vibe_tags contain an avoid term.
  if (c.avoid && c.avoid.length > 0) {
    const tags = (spot.vibe_tags ?? []).map((t) => t.toLowerCase())
    if (c.avoid.some((a) => tags.includes(a.toLowerCase()))) return false
  }

  return true
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function scoreSpot(spot: Spot, c: HardConstraints, origin?: { lat: number; lng: number }): {
  score: number
  matchedVibes: string[]
  distance?: number
} {
  let score = 0

  // Workability is the dominant signal — 0-10 → 0-60 weight here.
  if (spot.workability_score != null) {
    score += Number(spot.workability_score) * 6
  } else {
    // Unscored spots get a neutral baseline so they're not penalized
    // out of existence — better to surface a plausible spot than hide it.
    score += 25
  }

  // Vibe matches: each matched tag = +5
  const tags = (spot.vibe_tags ?? []).map((t) => t.toLowerCase())
  const matchedVibes: string[] = []
  for (const wanted of c.vibe ?? []) {
    if (tags.includes(wanted.toLowerCase())) {
      score += 5
      matchedVibes.push(wanted)
    }
  }

  // Feature alignment beyond hard filter (small bonuses for nice-to-haves
  // when not required)
  if (spot.has_outlets) score += 3
  if (spot.laptop_friendly) score += 3

  // Distance: prefer closer spots when origin provided. Within 500m = +15,
  // 500-1500m = +5, beyond = 0.
  let distance: number | undefined
  if (origin && spot.lat != null && spot.lng != null) {
    distance = haversineMeters(origin.lat, origin.lng, Number(spot.lat), Number(spot.lng))
    if (distance < 500) score += 15
    else if (distance < 1500) score += 5
  }

  return { score, matchedVibes, distance }
}

/** Build the "why this fits" sentence from structured fields. Deterministic;
 * never invents content. */
function fitReason(spot: Spot, mode: ModeId, matchedVibes: string[]): string {
  const parts: string[] = []

  if (spot.workability_score != null) {
    const s = Number(spot.workability_score).toFixed(1)
    parts.push(`${s}/10 workability`)
  }

  if (mode === 'deep_work' || mode === 'client_meeting') {
    if (spot.noise_level === 'quiet' || spot.noise_level === 'silent') {
      parts.push(`${spot.noise_level} atmosphere`)
    }
    if (spot.has_wifi) parts.push('wifi')
    if (spot.has_outlets) parts.push('outlets')
  }

  if (mode === 'coffee_date' || mode === 'creative_reset') {
    if (matchedVibes.length > 0) parts.push(matchedVibes.join(', '))
    if (spot.noise_level === 'moderate') parts.push('conversational')
  }

  if (parts.length === 0) {
    return 'Good match based on type and amenities'
  }
  return parts.join(' · ')
}

export function rankSpots(spots: Spot[], opts: RankOptions): RankedSpot[] {
  const { mode, modifiers = [], origin, limit = 8 } = opts

  // 'other' falls through to the broadest possible result set — we don't
  // run the LLM intent parser here. Caller should not pick 'other' on /find.
  if (mode === 'other') {
    return spots
      .filter((s) => s.status === 'approved')
      .slice(0, limit)
      .map((spot) => ({
        spot,
        fit_score: spot.workability_score ? Number(spot.workability_score) * 10 : 50,
        fit_reason: 'General match — try a more specific mode for better picks',
      }))
  }

  const constraints = mergeConstraints(mode, modifiers)
  const filtered = spots.filter((s) => passesHardFilter(s, constraints))

  // If the strict filter empties out, relax by removing avoid + vibe constraints
  // and try again. Better to return *something* than to show an empty state.
  const candidates =
    filtered.length > 0
      ? filtered
      : spots.filter((s) =>
          passesHardFilter(s, { ...constraints, vibe: undefined, avoid: undefined })
        )

  const ranked = candidates
    .map((spot) => {
      const { score, matchedVibes, distance } = scoreSpot(spot, constraints, origin)
      return {
        spot,
        fit_score: Math.round(score),
        fit_reason: fitReason(spot, mode, matchedVibes),
        distance_meters: distance != null ? Math.round(distance) : undefined,
      }
    })
    .sort((a, b) => b.fit_score - a.fit_score)
    .slice(0, limit)

  return ranked
}
