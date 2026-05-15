// ─────────────────────────────────────────────────────────────
// Fit scorer — deterministic, transparent scoring of each candidate
// cafe against the parsed intent.
//
// Why deterministic instead of "ask Claude to score": this stage
// runs once per candidate (up to 20× per request), so per-cafe LLM
// calls would dominate both latency and cost. More importantly,
// deterministic scoring gives the evaluator a stable target to
// reason about — "the recommender picked spot X with fitScore 78,
// here's the exact component breakdown" — which is what makes the
// observability story honest.
//
// Each component contributes to the final fit score weighted by
// the intent's `priorities` map: a "must" constraint that fails
// hurts more than a "nice" that fails.
// ─────────────────────────────────────────────────────────────

import { isOpenLate, isOpenAfterMidnight } from '@/lib/utils'
import type { NoiseLevel, Spot } from '@/types'
import type { FitScore, ParsedIntent, Priority } from './types'
import { isNeighborhoodInBorough } from './geo'

// Priority → weight multiplier applied to the component score. A
// missed "must" hurts the most; a satisfied "nice" still helps.
const WEIGHT: Record<Priority, number> = { must: 3, should: 2, nice: 1 }

// Map noise tolerance → numeric ceiling for comparison.
const NOISE_RANK: Record<NoiseLevel, number> = {
  silent: 0,
  quiet: 1,
  moderate: 2,
  loud: 3,
}

function priorityFor(
  intent: ParsedIntent,
  key: keyof ParsedIntent['priorities']
): Priority {
  return intent.priorities[key] ?? 'should'
}

// ── Component scorers ────────────────────────────────────────
// Each returns { score 0-100, reasons[], tradeoffs[], missing[], applicable }
// `applicable=false` means the user said nothing about this
// dimension, so it shouldn't influence the total either way.

type Component = {
  score: number
  reasons: string[]
  tradeoffs: string[]
  missing: string[]
  applicable: boolean
  priority: Priority
}

function scoreLocation(intent: ParsedIntent, spot: Spot): Component {
  const reasons: string[] = []
  const tradeoffs: string[] = []
  const missing: string[] = []
  let score = 50
  let applicable = false

  if (intent.city) {
    applicable = true
    if (spot.city.toLowerCase() === intent.city.toLowerCase()) {
      score = 90
      reasons.push(`In ${spot.city}`)
    } else {
      score = 20
      tradeoffs.push(`In ${spot.city}, not ${intent.city}`)
    }
  }

  if (intent.neighborhood) {
    applicable = true
    const n = (spot.neighborhood ?? '').toLowerCase()
    const target = intent.neighborhood.toLowerCase()

    // Three-way match: (1) borough-aware lookup (e.g. "Manhattan"
    // matches Midtown/SoHo/Tribeca), (2) substring on neighborhood,
    // (3) substring on address. Anything that misses all three is
    // genuinely in a different area and gets the penalty.
    const boroughMatch = isNeighborhoodInBorough(intent.neighborhood, spot.neighborhood)
    const substringMatch =
      n.includes(target) || spot.address.toLowerCase().includes(target)

    if (boroughMatch) {
      score = Math.max(score, 95)
      reasons.push(`${spot.neighborhood} is in ${intent.neighborhood}`)
    } else if (substringMatch) {
      score = Math.max(score, 95)
      reasons.push(`Located in ${spot.neighborhood ?? intent.neighborhood}`)
    } else if (spot.neighborhood) {
      score = Math.min(score, 55)
      tradeoffs.push(`${spot.neighborhood}, not ${intent.neighborhood}`)
    } else {
      missing.push(`Neighborhood data unavailable`)
    }
  }

  if (intent.transit.length > 0) {
    applicable = true
    // We don't have transit-line data in the spots table, so this
    // is always "missing data" — the recommender can still mention
    // the address and let the user judge. This is the kind of
    // explicit "missing data" the eval step looks for.
    missing.push(`Transit proximity (${intent.transit.join(', ')}) not verified`)
  }

  return {
    score,
    reasons,
    tradeoffs,
    missing,
    applicable,
    priority: priorityFor(intent, intent.neighborhood ? 'neighborhood' : 'city'),
  }
}

function scoreTime(intent: ParsedIntent, spot: Spot): Component {
  const reasons: string[] = []
  const tradeoffs: string[] = []
  const missing: string[] = []
  let score = 50
  let applicable = false

  // Coarse heuristic on the timeOfDay string. Real production code
  // would resolve to an absolute time and check hours per day; for
  // a demo this matches the existing is-open helpers.
  if (intent.timeOfDay) {
    applicable = true
    const t = intent.timeOfDay.toLowerCase()
    const wantsLate = /late|after\s*(6|7|8|9|10|11)\s*pm|evening|night|midnight/.test(t)
    const wantsOvernight = /midnight|3am|2am|overnight|24\s*hour/.test(t)

    if (wantsOvernight) {
      if (isOpenAfterMidnight(spot.hours)) {
        score = 95
        reasons.push('Open past midnight — fits the overnight ask')
      } else {
        score = 15
        tradeoffs.push('Closes before midnight')
      }
    } else if (wantsLate) {
      if (isOpenLate(spot.hours)) {
        score = 85
        reasons.push('Open late — fits the evening ask')
      } else {
        score = 30
        tradeoffs.push('Closes before 9pm')
      }
    } else {
      // Daytime or unspecified — most cafes are open, give a
      // mild positive signal.
      score = 75
      reasons.push('Open during typical daytime hours')
    }
  }

  if (intent.durationMinutes) {
    applicable = true
    // Long stays are a vibe/laptop-friendly question more than a
    // hours question — we trust the recommender to flag short-stay
    // expectations.
    if (intent.durationMinutes >= 120 && spot.laptop_friendly) {
      reasons.push('Laptop-friendly for a multi-hour stay')
    } else if (intent.durationMinutes >= 120 && !spot.laptop_friendly) {
      tradeoffs.push(`Not laptop-friendly for a ${intent.durationMinutes / 60}-hour stay`)
      score = Math.min(score, 40)
    }
  }

  return {
    score,
    reasons,
    tradeoffs,
    missing,
    applicable,
    priority: priorityFor(intent, 'timeOfDay'),
  }
}

function scoreNoise(intent: ParsedIntent, spot: Spot): Component {
  const reasons: string[] = []
  const tradeoffs: string[] = []
  const missing: string[] = []

  if (!intent.noiseTolerance) {
    return { score: 50, reasons, tradeoffs, missing, applicable: false, priority: 'nice' }
  }
  if (!spot.noise_level) {
    return {
      score: 50,
      reasons,
      tradeoffs,
      missing: ['Noise level not recorded'],
      applicable: true,
      priority: priorityFor(intent, 'noiseTolerance'),
    }
  }
  const ceiling = NOISE_RANK[intent.noiseTolerance]
  const actual = NOISE_RANK[spot.noise_level]

  let score: number
  if (actual <= ceiling) {
    score = 90 - (ceiling - actual) * 5 // exact match best; calmer than asked = also good
    reasons.push(`Noise level "${spot.noise_level}" — within your "${intent.noiseTolerance}" tolerance`)
  } else {
    // Louder than asked — penalty proportional to how far over.
    score = Math.max(15, 60 - (actual - ceiling) * 25)
    tradeoffs.push(`Noise level "${spot.noise_level}" — louder than your "${intent.noiseTolerance}" tolerance`)
  }
  return {
    score,
    reasons,
    tradeoffs,
    missing,
    applicable: true,
    priority: priorityFor(intent, 'noiseTolerance'),
  }
}

function scoreFeatures(intent: ParsedIntent, spot: Spot): Component {
  const reasons: string[] = []
  const tradeoffs: string[] = []
  const missing: string[] = []
  const scores: number[] = []

  const checks: Array<{
    asked: boolean | null
    actual: boolean
    label: string
    priorityKey: keyof ParsedIntent['priorities']
  }> = [
    { asked: intent.needsOutlets, actual: spot.has_outlets, label: 'outlets', priorityKey: 'needsOutlets' },
    { asked: intent.needsWifi, actual: spot.has_wifi, label: 'wifi', priorityKey: 'needsWifi' },
    { asked: intent.laptopFriendly, actual: spot.laptop_friendly, label: 'laptop-friendly', priorityKey: 'laptopFriendly' },
    { asked: intent.needsFood, actual: spot.has_food, label: 'food', priorityKey: 'needsFood' },
  ]

  let applicable = false
  let aggregatePriority: Priority = 'nice'

  for (const c of checks) {
    if (c.asked === null || c.asked === false) continue
    applicable = true
    const p = priorityFor(intent, c.priorityKey)
    if (WEIGHT[p] > WEIGHT[aggregatePriority]) aggregatePriority = p

    if (c.actual) {
      scores.push(95)
      reasons.push(`Has ${c.label}`)
    } else {
      scores.push(p === 'must' ? 10 : 35)
      tradeoffs.push(`No ${c.label}`)
    }
  }

  if (!applicable) {
    return { score: 50, reasons, tradeoffs, missing, applicable: false, priority: 'nice' }
  }
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length
  return { score: avg, reasons, tradeoffs, missing, applicable: true, priority: aggregatePriority }
}

function scoreVibe(intent: ParsedIntent, spot: Spot): Component {
  const reasons: string[] = []
  const tradeoffs: string[] = []
  const missing: string[] = []
  if (intent.vibe.length === 0) {
    return { score: 50, reasons, tradeoffs, missing, applicable: false, priority: 'nice' }
  }

  const tags = new Set(spot.vibe_tags.map((t) => t.toLowerCase()))
  let hits = 0
  for (const v of intent.vibe) {
    const needle = v.toLowerCase()
    // Substring match against any tag — vibe tags are short phrases.
    const match = [...tags].some((t) => t.includes(needle) || needle.includes(t))
    if (match) {
      hits++
      reasons.push(`Vibe tag matches "${v}"`)
    }
  }
  if (intent.avoid.length > 0) {
    for (const a of intent.avoid) {
      const needle = a.toLowerCase()
      const hit = [...tags].some((t) => t.includes(needle))
      if (hit) tradeoffs.push(`Vibe tag suggests "${a}" — on your avoid list`)
    }
  }
  const ratio = hits / intent.vibe.length
  const score = ratio * 95 + (1 - ratio) * 35
  return {
    score,
    reasons,
    tradeoffs,
    missing,
    applicable: true,
    priority: priorityFor(intent, 'vibe'),
  }
}

// ── Aggregate ─────────────────────────────────────────────────

function aggregate(components: Component[]): number {
  // Only weight components the user actually expressed a constraint
  // about — otherwise a request that mentions only "outlets" would
  // be diluted by neutral 50s from time/location/vibe.
  const used = components.filter((c) => c.applicable)
  if (used.length === 0) {
    // No constraints at all — fall back to the average score of
    // all components (i.e. 50, neutral).
    return 50
  }
  const numer = used.reduce((s, c) => s + c.score * WEIGHT[c.priority], 0)
  const denom = used.reduce((s, c) => s + 100 * WEIGHT[c.priority], 0)
  return Math.round((numer / denom) * 100)
}

function confidenceFrom(components: Component[]): number {
  // Confidence drops as missing-data items accumulate, or when the
  // user expressed many constraints we couldn't address.
  const applicable = components.filter((c) => c.applicable).length
  const totalMissing = components.reduce((s, c) => s + c.missing.length, 0)
  if (applicable === 0) return 0.4
  const base = 0.95
  const penalty = Math.min(0.5, totalMissing * 0.12)
  return Math.max(0.3, base - penalty)
}

// ── Public API ────────────────────────────────────────────────

export function scoreCandidates(
  intent: ParsedIntent,
  candidates: Spot[]
): FitScore[] {
  const scored: FitScore[] = candidates.map((spot) => {
    const cLoc = scoreLocation(intent, spot)
    const cTime = scoreTime(intent, spot)
    const cNoise = scoreNoise(intent, spot)
    const cFeat = scoreFeatures(intent, spot)
    const cVibe = scoreVibe(intent, spot)
    const components = [cLoc, cTime, cNoise, cFeat, cVibe]

    return {
      spotId: spot.id,
      spotName: spot.name,
      fitScore: aggregate(components),
      confidence: Math.round(confidenceFrom(components) * 100) / 100,
      reasons: components.flatMap((c) => c.reasons),
      tradeoffs: components.flatMap((c) => c.tradeoffs),
      missingData: components.flatMap((c) => c.missing),
      componentScores: {
        location: Math.round(cLoc.score),
        time: Math.round(cTime.score),
        noise: Math.round(cNoise.score),
        features: Math.round(cFeat.score),
        vibe: Math.round(cVibe.score),
      },
    }
  })

  return scored.sort((a, b) => b.fitScore - a.fitScore)
}
