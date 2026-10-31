import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { SpotHours, DayHours, Spot } from '@/types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ── Hours helpers ─────────────────────────────────────────────

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
type DayKey = typeof DAYS[number]

export function getTodayKey(): DayKey {
  return DAYS[new Date().getDay()]
}

export function getTodayHours(hours: SpotHours | null): DayHours {
  if (!hours) return null
  return hours[getTodayKey()] ?? null
}

/** Parse "HH:MM" → total minutes since midnight. "00:00" on close = 24*60 for overnight. */
function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export function isOpenNow(hours: SpotHours | null): boolean {
  const todayHours = getTodayHours(hours)
  if (!todayHours) return false

  const now = new Date()
  const current = now.getHours() * 60 + now.getMinutes()
  const open = timeToMinutes(todayHours.open)
  let close = timeToMinutes(todayHours.close)

  // If close is 00:00 or 23:59 treat as 23:59 (end of day)
  if (close === 0) close = 24 * 60 - 1

  // Overnight case: open=22:00 close=02:00
  if (close < open) {
    return current >= open || current <= close
  }
  return current >= open && current <= close
}

export function closingTimeToday(hours: SpotHours | null): string | null {
  const todayHours = getTodayHours(hours)
  if (!todayHours) return null
  return todayHours.close
}

export function isOpenLate(hours: SpotHours | null): boolean {
  const close = closingTimeToday(hours)
  if (!close) return false
  const closeMin = timeToMinutes(close)
  return closeMin === 0 || closeMin >= 21 * 60
}

export function isOpenAfter9pm(hours: SpotHours | null): boolean {
  const close = closingTimeToday(hours)
  if (!close) return false
  const closeMin = timeToMinutes(close)
  return closeMin === 0 || closeMin >= 21 * 60
}

export function isOpenAfterMidnight(hours: SpotHours | null): boolean {
  const close = closingTimeToday(hours)
  if (!close) return false
  const closeMin = timeToMinutes(close)
  return closeMin === 0 || closeMin >= 24 * 60 || closeMin < 6 * 60
}

export function is24Hours(hours: SpotHours | null): boolean {
  if (!hours) return false
  return DAYS.every((day) => {
    const h = hours[day]
    if (!h) return false
    return h.open === '00:00' && (h.close === '23:59' || h.close === '00:00')
  })
}

export function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const period = h >= 12 ? 'pm' : 'am'
  const hour = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hour}${period}` : `${hour}:${m.toString().padStart(2, '0')}${period}`
}

export function formatHoursDisplay(hours: SpotHours | null): string {
  if (!hours) return 'Hours unknown'
  if (is24Hours(hours)) return 'Open 24 hours'

  const today = getTodayHours(hours)
  if (!today) return 'Closed today'
  return `${formatTime(today.open)} – ${formatTime(today.close)}`
}

// ── Score helpers ─────────────────────────────────────────────

export function scoreColor(score: number): string {
  if (score >= 8) return 'text-emerald-400'
  if (score >= 6) return 'text-yellow-400'
  if (score >= 4) return 'text-orange-400'
  return 'text-red-400'
}

export function scoreBg(score: number): string {
  if (score >= 8) return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
  if (score >= 6) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
  if (score >= 4) return 'bg-orange-500/20 text-orange-400 border-orange-500/30'
  return 'bg-red-500/20 text-red-400 border-red-500/30'
}

export function formatScore(score: number): string {
  return score.toFixed(1)
}

// `work_score` is a Google-review-keyword-derived score (see
// scoreFromReviews() in lib/google-places.ts), not a score built from
// Cafelist's own on-platform reviews. Its scoring engine clamps to a
// 2.0 floor, so a row sitting at exactly the raw column default (0) was
// never run through it — that's true for every scout-agent row today,
// because the curator pipeline only ever writes `workability_score`,
// never backfills `work_score`. Treat that combination as "unknown",
// not "scored zero" — see the fuller note in lib/spots.ts. Lives here
// (not lib/spots.ts) so client components can import it without pulling
// in the Supabase admin client.
export function isWorkScoreUnknown(spot: Pick<Spot, 'work_score' | 'submitted_by'>): boolean {
  return spot.work_score === 0 && spot.submitted_by === 'scout-agent'
}

// True when a spot's data is unverified/unconfirmed enough that showing a
// precise one-decimal score would overstate our confidence. Presentation
// code should show "Not yet verified" (or similar) instead in this case.
//
// Prefers the `data_confidence` column added by
// supabase/migrations/20261031_outlet_status_and_data_confidence.sql once
// it's applied and flowing through `select('*')`. Until then (or for any
// caller that hasn't re-fetched with the new column), falls back to the
// equivalent direct check the migration's own backfill logic uses:
// "no enrichment signal of any kind" — no last_verified_at, no
// enriched_at, no workability_scored_at.
export function isDataConfidenceUnknown(
  spot: Pick<Spot, 'data_confidence' | 'last_verified_at' | 'enriched_at' | 'workability_scored_at'>
): boolean {
  if (spot.data_confidence != null) return spot.data_confidence === 'unknown'
  return !spot.last_verified_at && !spot.enriched_at && !spot.workability_scored_at
}

// ── Type label helpers ────────────────────────────────────────

export const TYPE_LABELS: Record<string, string> = {
  coffee_shop: 'Coffee Shop',
  hotel_lobby: 'Hotel Lobby',
  diner: 'Diner',
  bar: 'Bar',
  library: 'Library',
  coworking: 'Coworking',
  other: 'Other',
}

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type
}

// ── Slug helper ───────────────────────────────────────────────

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}
