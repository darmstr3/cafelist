import { ScoreBreakdown, Signal, SignalType, CafeHours } from '@/types/cafe'

// ── Keyword lists ─────────────────────────────────────────────

const WIFI_POSITIVE = [
  'good wifi', 'great wifi', 'fast wifi', 'strong wifi', 'free wifi',
  'excellent wifi', 'solid wifi', 'reliable wifi', 'fast internet',
  'great internet', 'good internet', 'strong signal', 'good signal',
]
const WIFI_NEGATIVE = [
  'no wifi', 'slow wifi', 'bad wifi', 'terrible wifi', 'spotty wifi',
  'weak wifi', 'no internet', 'poor wifi', 'wifi doesn\'t work',
  'wifi is down', 'ask for password',
]
const WIFI_NEUTRAL = ['wifi', 'wi-fi', 'wireless', 'internet', 'connection', 'network', 'hotspot']

const OUTLET_POSITIVE = [
  'lots of outlets', 'plenty of outlets', 'outlets everywhere',
  'many outlets', 'power strips', 'outlets available', 'usb port',
  'usb charging', 'easily find outlet',
]
const OUTLET_NEGATIVE = [
  'no outlet', 'no outlets', 'limited outlets', 'no charging',
  'can\'t charge', 'hard to find outlet', 'no power',
]
const OUTLET_NEUTRAL = ['outlet', 'outlets', 'charging', 'plug', 'power', 'usb', 'socket']

const QUIET_KEYWORDS = [
  'quiet', 'peaceful', 'calm', 'serene', 'relaxed', 'tranquil',
  'not loud', 'low noise', 'easy to focus', 'great for work',
  'good for working', 'library vibe', 'studious', 'no music', 'silent',
]
const LOUD_KEYWORDS = [
  'loud', 'noisy', 'crowded', 'packed', 'blasting music', 'too loud',
  'hard to concentrate', 'can\'t work', 'distracting', 'chaotic',
  'rowdy', 'bass', 'club music', 'screaming', 'can\'t hear',
]

const LAPTOP_KEYWORDS = [
  'laptop', 'remote work', 'working', 'work from', 'wfh', 'digital nomad',
  'study', 'studying', 'focused', 'productive', 'work session',
]

// ── Helpers ───────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function countPhrases(text: string, phrases: string[]): number {
  return phrases.filter((p) => text.includes(p)).length
}

function countWords(text: string, words: string[]): number {
  return words.reduce((count, word) => {
    const regex = new RegExp(`\\b${word.replace(/[-']/g, '.?')}\\b`, 'gi')
    const matches = text.match(regex)
    return count + (matches?.length ?? 0)
  }, 0)
}

// ── Per-component scorers ─────────────────────────────────────

export function scoreWifi(allText: string): { score: number; mentions: number } {
  const t = allText.toLowerCase()
  const mentions = countWords(t, WIFI_NEUTRAL)
  const positive = countPhrases(t, WIFI_POSITIVE)
  const negative = countPhrases(t, WIFI_NEGATIVE)

  // Base: 2.5 pts per mention, +5 per positive phrase, -8 per negative phrase
  const raw = mentions * 2.5 + positive * 5 - negative * 8
  return { score: clamp(raw, 0, 30), mentions }
}

export function scoreOutlets(allText: string): { score: number; mentions: number } {
  const t = allText.toLowerCase()
  const mentions = countWords(t, OUTLET_NEUTRAL)
  const positive = countPhrases(t, OUTLET_POSITIVE)
  const negative = countPhrases(t, OUTLET_NEGATIVE)

  const raw = mentions * 2 + positive * 4 - negative * 6
  return { score: clamp(raw, 0, 20), mentions }
}

export function scoreNoise(allText: string): { score: number; quietMentions: number; loudMentions: number } {
  const t = allText.toLowerCase()
  const quietMentions = countWords(t, QUIET_KEYWORDS) + countPhrases(t, ['great for work', 'good for work'])
  const loudMentions = countWords(t, LOUD_KEYWORDS)

  // Start at 10 (neutral), quiet moves up, loud moves down
  const raw = 10 + quietMentions * 2 - loudMentions * 2
  return { score: clamp(raw, 0, 20), quietMentions, loudMentions }
}

export function scoreRating(rating: number): number {
  if (!rating || rating < 1) return 7.5  // neutral default
  // Normalize 1–5 → 0–15
  return clamp(((rating - 1) / 4) * 15, 0, 15)
}

export function scoreHours(hours: CafeHours): number {
  const days = Object.keys(hours) as Array<keyof CafeHours>
  if (days.length === 0) return 7 // unknown hours — neutral

  let pts = 0

  // +5 if open 7 days
  const openDays = days.filter((d) => hours[d] !== null).length
  if (openDays >= 7) pts += 5
  else if (openDays >= 6) pts += 3
  else if (openDays >= 5) pts += 1

  // Parse closing times to determine "open late"
  const closeTimes = days
    .filter((d) => hours[d])
    .map((d) => parseCloseTime(hours[d]!))
    .filter((t) => t !== null) as number[]

  if (closeTimes.length > 0) {
    const maxClose = Math.max(...closeTimes)

    if (maxClose >= 24 || maxClose < 6) pts += 6      // past midnight
    else if (maxClose >= 22) pts += 4                  // past 10pm
    else if (maxClose >= 21) pts += 3                  // past 9pm
    else if (maxClose >= 20) pts += 2                  // past 8pm
    else pts += 0                                      // closes before 8pm
  }

  // Parse open times — reward early openers
  const openTimes = days
    .filter((d) => hours[d])
    .map((d) => parseOpenTime(hours[d]!))
    .filter((t) => t !== null) as number[]

  if (openTimes.length > 0) {
    const minOpen = Math.min(...openTimes)
    if (minOpen <= 6) pts += 4       // before 7am
    else if (minOpen <= 7) pts += 3  // before 8am
    else if (minOpen <= 8) pts += 2  // before 9am
    else if (minOpen <= 9) pts += 1  // before 10am
  }

  return clamp(pts, 0, 15)
}

/** Parse "7 AM–10 PM" or "07:00–22:00" → close hour (24h) */
function parseCloseTime(hoursStr: string): number | null {
  const lower = hoursStr.toLowerCase()

  // "Open 24 hours" / "24hr"
  if (lower.includes('24 hour') || lower.includes('24hr') || lower.includes('open 24')) {
    return 24
  }

  // "7 AM–10 PM" format
  const match12 = hoursStr.match(/[–\-]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i)
  if (match12) {
    let h = parseInt(match12[1])
    const period = match12[3].toUpperCase()
    if (period === 'PM' && h !== 12) h += 12
    if (period === 'AM' && h === 12) h = 0
    return h
  }

  // "07:00–22:00" format
  const match24 = hoursStr.match(/[–\-]\s*(\d{2}):(\d{2})/)
  if (match24) {
    return parseInt(match24[1])
  }

  return null
}

function parseOpenTime(hoursStr: string): number | null {
  const lower = hoursStr.toLowerCase()
  if (lower.includes('24 hour') || lower.includes('open 24')) return 0

  // "7 AM–10 PM" format
  const match12 = hoursStr.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i)
  if (match12) {
    let h = parseInt(match12[1])
    const period = match12[3].toUpperCase()
    if (period === 'PM' && h !== 12) h += 12
    if (period === 'AM' && h === 12) h = 0
    return h
  }

  // "07:00–22:00" format
  const match24 = hoursStr.match(/^(\d{2}):(\d{2})/)
  if (match24) return parseInt(match24[1])

  return null
}

// ── Laptop mention count ──────────────────────────────────────

export function countLaptopMentions(allText: string): number {
  return countWords(allText.toLowerCase(), LAPTOP_KEYWORDS)
}

// ── Top signals ───────────────────────────────────────────────

export function buildTopSignals(breakdown: ScoreBreakdown, hours: CafeHours): Signal[] {
  const candidates: Array<{ signal: Signal; weight: number }> = []

  // WiFi signals
  if (breakdown.wifi >= 22)
    candidates.push({ signal: { type: 'wifi', label: 'Fast WiFi', icon: '📶', positive: true }, weight: breakdown.wifi })
  else if (breakdown.wifi >= 12)
    candidates.push({ signal: { type: 'wifi', label: 'WiFi Available', icon: '📶', positive: true }, weight: breakdown.wifi })
  else if (breakdown.wifi <= 4)
    candidates.push({ signal: { type: 'no_wifi', label: 'WiFi Issues', icon: '📵', positive: false }, weight: 30 - breakdown.wifi })

  // Outlet signals
  if (breakdown.outlets >= 14)
    candidates.push({ signal: { type: 'outlets', label: 'Plenty of Outlets', icon: '🔌', positive: true }, weight: breakdown.outlets })
  else if (breakdown.outlets >= 8)
    candidates.push({ signal: { type: 'outlets', label: 'Outlets Available', icon: '🔌', positive: true }, weight: breakdown.outlets })

  // Noise signals
  if (breakdown.noise >= 15)
    candidates.push({ signal: { type: 'quiet', label: 'Quiet & Focused', icon: '🔇', positive: true }, weight: breakdown.noise })
  else if (breakdown.noise >= 12)
    candidates.push({ signal: { type: 'quiet', label: 'Relatively Quiet', icon: '🔈', positive: true }, weight: breakdown.noise })
  else if (breakdown.noise <= 5)
    candidates.push({ signal: { type: 'noisy', label: 'Can Be Noisy', icon: '🔊', positive: false }, weight: 20 - breakdown.noise })

  // Hours signals
  if (breakdown.hours >= 12)
    candidates.push({ signal: { type: 'open_late', label: 'Open Late', icon: '🌙', positive: true }, weight: breakdown.hours })

  // Rating signal
  if (breakdown.rating >= 13)
    candidates.push({ signal: { type: 'highly_rated', label: 'Highly Rated', icon: '⭐', positive: true }, weight: breakdown.rating })

  // Sort by weight descending and take top 3
  return candidates
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((c) => c.signal)
}

// ── Main scorer ───────────────────────────────────────────────

export interface ScorerInput {
  allReviews: string[]
  rating: number
  hours: CafeHours
}

export function scoreCafe(input: ScorerInput): {
  breakdown: ScoreBreakdown
  wifiMentions: number
  outletMentions: number
  quietMentions: number
  loudMentions: number
  laptopMentions: number
} {
  const allText = input.allReviews.join(' ')

  const wifi = scoreWifi(allText)
  const outlets = scoreOutlets(allText)
  const noise = scoreNoise(allText)
  const rating = scoreRating(input.rating)
  const hours = scoreHours(input.hours)

  const total = Math.round(wifi.score + outlets.score + noise.score + rating + hours)

  return {
    breakdown: {
      wifi: Math.round(wifi.score),
      outlets: Math.round(outlets.score),
      noise: Math.round(noise.score),
      rating: Math.round(rating),
      hours: Math.round(hours),
      total: clamp(total, 0, 100),
    },
    wifiMentions: wifi.mentions,
    outletMentions: outlets.mentions,
    quietMentions: noise.quietMentions,
    loudMentions: noise.loudMentions,
    laptopMentions: countLaptopMentions(allText),
  }
}
