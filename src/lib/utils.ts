import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { SpotHours, DayHours } from '@/types'

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
