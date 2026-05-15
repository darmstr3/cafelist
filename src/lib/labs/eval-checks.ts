// ─────────────────────────────────────────────────────────────
// Deterministic eval checks — fast, model-free predicates that
// run BEFORE the judge so we can fail obviously-broken outputs
// without paying for a second LLM call.
//
// Used by scripts/eval.ts. Pure functions; no I/O.
// ─────────────────────────────────────────────────────────────

import { isBorough, isNeighborhoodInBorough } from './geo'
import type { Recommendation } from './types'
import type { NoiseLevel, Spot, SpotHours } from '@/types'

export interface HardConstraints {
  city?: string
  neighborhood?: string
  /** "HH:MM" 24h. */
  openAt?: string
  needsOutlets?: boolean
  needsWifi?: boolean
  maxNoise?: NoiseLevel
  minPicks?: number
  forbidsApology?: boolean
  /** Adversarial / contradictory cases — relax city/neighborhood
   *  checks but still require no-apology + low-confidence framing. */
  expectFailGracefully?: boolean
}

export interface CheckResult {
  /** Check identifier — used by the dashboard for grouping fails. */
  name: string
  /** True iff the check passed (or was not applicable). */
  ok: boolean
  /** One-line explanation when ok=false. */
  note?: string
}

export interface DeterministicReport {
  pass: boolean
  checks: CheckResult[]
  /** Just the names of the checks that failed — convenient for jsonb storage. */
  failed: string[]
}

const APOLOGY_RE =
  /^\s*(unfortunately|sorry|apologies|i'?m sorry|i apologi[sz]e|none\b|no\s+(matches|results|spots)|i (can'?t|cannot))/i

const NOISE_RANK: Record<NoiseLevel, number> = {
  silent: 0,
  quiet: 1,
  moderate: 2,
  loud: 3,
}

const WEEKDAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const

type WeekdayKey = (typeof WEEKDAY_KEYS)[number]

export function runDeterministicChecks(args: {
  recommendation: Recommendation | null
  topPick: Spot | null
  constraints: HardConstraints
  weekday: WeekdayKey
}): DeterministicReport {
  const { recommendation, topPick, constraints, weekday } = args
  const checks: CheckResult[] = []
  const adversarial = !!constraints.expectFailGracefully

  // ── minPicks ────────────────────────────────────────────────
  const minPicks = constraints.minPicks ?? 1
  const picksCount = recommendation?.picks.length ?? 0
  checks.push({
    name: 'minPicks',
    ok: picksCount >= minPicks,
    note:
      picksCount >= minPicks ? undefined : `picks.length=${picksCount} < minPicks=${minPicks}`,
  })

  // ── forbidsApology ──────────────────────────────────────────
  if (constraints.forbidsApology !== false) {
    const summary = recommendation?.summary ?? ''
    const apologetic = APOLOGY_RE.test(summary)
    checks.push({
      name: 'forbidsApology',
      ok: !apologetic,
      note: apologetic ? `summary starts with apology: "${summary.slice(0, 80)}"` : undefined,
    })
  }

  // ── adversarial: confidence flagged as low ──────────────────
  if (adversarial) {
    const note = (recommendation?.confidenceNote ?? '').toLowerCase()
    const flagged =
      note.includes('low') ||
      note.includes('weak') ||
      note.includes('no data') ||
      note.includes('not a strong') ||
      note.includes('fallback') ||
      note.includes('uncertain')
    checks.push({
      name: 'adversarialCalibration',
      ok: flagged,
      note: flagged
        ? undefined
        : `expected low-confidence framing in confidenceNote, got: "${recommendation?.confidenceNote ?? ''}"`,
    })
  }

  // ── city match (skipped for adversarial cases) ──────────────
  if (constraints.city && topPick && !adversarial) {
    const need = constraints.city.toLowerCase()
    const got = (topPick.city ?? '').toLowerCase()
    const ok = got.includes(need) || need.includes(got)
    checks.push({
      name: 'cityMatch',
      ok,
      note: ok ? undefined : `top pick city="${topPick.city}" vs required="${constraints.city}"`,
    })
  }

  // ── neighborhood / borough match ────────────────────────────
  if (constraints.neighborhood && topPick && !adversarial) {
    const need = constraints.neighborhood
    const neigh = topPick.neighborhood ?? ''
    const addr = topPick.address ?? ''
    let ok = false
    if (isBorough(need)) {
      ok = isNeighborhoodInBorough(need, neigh)
    } else {
      ok =
        neigh.toLowerCase().includes(need.toLowerCase()) ||
        addr.toLowerCase().includes(need.toLowerCase())
    }
    checks.push({
      name: 'neighborhoodMatch',
      ok,
      note: ok ? undefined : `top pick neighborhood="${neigh}" vs required="${need}"`,
    })
  }

  // ── openAt: hours on weekday cover that time ────────────────
  if (constraints.openAt && topPick && !adversarial) {
    const ok = hoursCoverTime(topPick.hours, weekday, constraints.openAt)
    checks.push({
      name: 'openAt',
      ok,
      note: ok
        ? undefined
        : `top pick hours on ${weekday} do not cover ${constraints.openAt}`,
    })
  }

  // ── feature flags ───────────────────────────────────────────
  if (constraints.needsOutlets && topPick && !adversarial) {
    checks.push({
      name: 'needsOutlets',
      ok: !!topPick.has_outlets,
      note: topPick.has_outlets ? undefined : 'top pick has_outlets=false',
    })
  }
  if (constraints.needsWifi && topPick && !adversarial) {
    checks.push({
      name: 'needsWifi',
      ok: !!topPick.has_wifi,
      note: topPick.has_wifi ? undefined : 'top pick has_wifi=false',
    })
  }

  // ── maxNoise ────────────────────────────────────────────────
  if (constraints.maxNoise && topPick && !adversarial) {
    const got = topPick.noise_level
    if (got == null) {
      // No data on noise — treat as soft-pass with a note rather than
      // failing a deterministic check. The judge will reason about it.
      checks.push({ name: 'maxNoise', ok: true, note: 'noise_level unknown on top pick' })
    } else {
      const ok = NOISE_RANK[got] <= NOISE_RANK[constraints.maxNoise]
      checks.push({
        name: 'maxNoise',
        ok,
        note: ok
          ? undefined
          : `top pick noise_level="${got}" exceeds max="${constraints.maxNoise}"`,
      })
    }
  }

  const failed = checks.filter((c) => !c.ok).map((c) => c.name)
  return {
    pass: failed.length === 0,
    checks,
    failed,
  }
}

// ── helpers ───────────────────────────────────────────────────

function hoursCoverTime(
  hours: SpotHours | null | undefined,
  weekday: WeekdayKey,
  hhmm: string
): boolean {
  if (!hours) return false
  const day = hours[weekday]
  if (!day) return false
  const target = toMinutes(hhmm)
  if (target == null) return false
  const open = toMinutes(day.open)
  const close = toMinutes(day.close)
  if (open == null || close == null) return false
  // Overnight close (e.g. 06:00–02:00) — treat close < open as next-day.
  if (close <= open) {
    return target >= open || target <= close
  }
  return target >= open && target <= close
}

function toMinutes(hhmm: string): number | null {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  if (Number.isNaN(h) || Number.isNaN(mi)) return null
  return h * 60 + mi
}
