/**
 * Google Places API v1 client
 * Docs: https://developers.google.com/maps/documentation/places/web-service/overview
 */

const BASE = 'https://places.googleapis.com/v1'

// Read lazily so scripts that load .env.local after module import still work
function getApiKey(): string {
  return process.env.GOOGLE_PLACES_API_KEY ?? ''
}

// ── Types ─────────────────────────────────────────────────────

export interface GPLocation {
  latitude: number
  longitude: number
}

export interface GPPeriodPoint {
  day: number   // 0=Sun … 6=Sat
  hour: number
  minute: number
}

export interface GPPeriod {
  open: GPPeriodPoint
  close?: GPPeriodPoint  // undefined = open 24h
}

export interface GPOpeningHours {
  openNow?: boolean
  periods?: GPPeriod[]
  weekdayDescriptions?: string[]
}

export interface GPPhotoRef {
  name: string            // e.g. "places/ABC/photos/XYZ"
  widthPx: number
  heightPx: number
}

export interface GPReview {
  name: string
  relativePublishTimeDescription: string
  rating: number          // 1–5
  text?: { text: string; languageCode: string }
  authorAttribution?: { displayName: string; uri: string; photoUri: string }
}

export interface GPPlace {
  id: string
  displayName?: { text: string; languageCode: string }
  formattedAddress?: string
  location?: GPLocation
  rating?: number
  userRatingCount?: number
  types?: string[]
  priceLevel?: string       // PRICE_LEVEL_FREE | _INEXPENSIVE | _MODERATE | _EXPENSIVE | _VERY_EXPENSIVE
  businessStatus?: string   // OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY
  regularOpeningHours?: GPOpeningHours
  currentOpeningHours?: GPOpeningHours
  photos?: GPPhotoRef[]
  reviews?: GPReview[]
  editorialSummary?: { text: string }
  websiteUri?: string
  internationalPhoneNumber?: string
}

export interface GPTextSearchResponse {
  places: GPPlace[]
  nextPageToken?: string
}

// ── Core fetch helper ─────────────────────────────────────────

async function gFetch<T>(
  endpoint: string,
  options: {
    method?: 'GET' | 'POST'
    body?: object
    fieldMask: string
  }
): Promise<T> {
  const url = `${BASE}${endpoint}`
  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': getApiKey(),
      'X-Goog-FieldMask': options.fieldMask,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Places API ${res.status}: ${text}`)
  }

  return res.json() as Promise<T>
}

// ── Text Search ───────────────────────────────────────────────

const SEARCH_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.types',
  'places.priceLevel',
  'places.businessStatus',
  'places.regularOpeningHours',
  'places.photos',
].join(',')

export async function textSearch(
  query: string,
  options?: {
    maxResults?: number
    lat?: number
    lng?: number
    radiusMeters?: number
  }
): Promise<GPPlace[]> {
  const body: Record<string, unknown> = {
    textQuery: query,
    maxResultCount: options?.maxResults ?? 20,
    languageCode: 'en',
  }

  if (options?.lat && options?.lng) {
    body.locationBias = {
      circle: {
        center: { latitude: options.lat, longitude: options.lng },
        radius: options.radiusMeters ?? 30000,
      },
    }
  }

  const res = await gFetch<GPTextSearchResponse>('/places:searchText', {
    method: 'POST',
    body,
    fieldMask: SEARCH_FIELD_MASK,
  })

  return (res.places ?? []).filter((p) => p.businessStatus !== 'CLOSED_PERMANENTLY')
}

// ── Place Details (includes reviews) ─────────────────────────

const DETAIL_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'rating',
  'userRatingCount',
  'types',
  'priceLevel',
  'businessStatus',
  'regularOpeningHours',
  'photos',
  'reviews',
  'editorialSummary',
  'websiteUri',
].join(',')

export async function getPlaceDetails(placeId: string): Promise<GPPlace> {
  return gFetch<GPPlace>(`/places/${placeId}`, {
    method: 'GET',
    fieldMask: DETAIL_FIELD_MASK,
  })
}

// ── Photo URL helper ──────────────────────────────────────────

/**
 * Converts a Places API photo name into a fetchable photo URL.
 * name format: "places/PLACE_ID/photos/PHOTO_REF"
 */
export function photoUrl(photoName: string, maxWidth = 800): string {
  return `${BASE}/${photoName}/media?maxWidthPx=${maxWidth}&key=${getApiKey()}&skipHttpRedirect=true`
}

/**
 * Returns a direct Google photo redirect URL (simpler, no extra fetch needed).
 */
export function photoUrlRedirect(photoName: string, maxWidth = 800): string {
  return `${BASE}/${photoName}/media?maxWidthPx=${maxWidth}&key=${getApiKey()}`
}

// ── Hours conversion ──────────────────────────────────────────

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

function pad(n: number) {
  return String(n).padStart(2, '0')
}

export function convertHours(hours: GPOpeningHours | undefined): Record<string, { open: string; close: string } | null> | null {
  if (!hours?.periods) return null

  const result: Record<string, { open: string; close: string } | null> = {
    monday: null, tuesday: null, wednesday: null, thursday: null,
    friday: null, saturday: null, sunday: null,
  }

  // 24/7 check: single period with open.day=0, open.hour=0, no close
  if (hours.periods.length === 1 && !hours.periods[0].close) {
    for (const day of DAY_KEYS) result[day] = { open: '00:00', close: '23:59' }
    return result
  }

  for (const period of hours.periods) {
    const dayKey = DAY_KEYS[period.open.day]
    if (!dayKey) continue

    const openStr = `${pad(period.open.hour)}:${pad(period.open.minute)}`
    const closeStr = period.close
      ? `${pad(period.close.hour)}:${pad(period.close.minute)}`
      : '23:59'

    result[dayKey] = { open: openStr, close: closeStr }
  }

  return result
}

// ── Place type → our type mapping ────────────────────────────

export function mapPlaceType(types: string[]): string {
  if (types.includes('bar') || types.includes('night_club')) return 'bar'
  if (types.includes('lodging') || types.includes('hotel')) return 'hotel_lobby'
  if (types.includes('library')) return 'library'
  if (
    types.includes('meal_delivery') ||
    types.includes('meal_takeaway') ||
    types.includes('diner') ||
    (types.includes('restaurant') && !types.includes('cafe'))
  ) return 'diner'
  if (types.includes('cafe') || types.includes('coffee_shop')) return 'coffee_shop'
  return 'other'
}

// ── Review → scores engine ────────────────────────────────────

interface WorkScores {
  wifi_score: number
  outlet_score: number
  noise_score: number
  seating_score: number
  late_night_score: number
  work_score: number
}

interface KeywordRule {
  positive: string[]
  negative: string[]
}

const RULES: Record<keyof Omit<WorkScores, 'work_score'>, KeywordRule> = {
  wifi_score: {
    positive: ['wifi', 'wi-fi', 'fast internet', 'good wifi', 'great wifi', 'strong wifi', 'great connection', 'strong signal', 'good signal', 'good internet', 'fast wifi'],
    negative: ['no wifi', 'slow wifi', 'bad wifi', 'terrible wifi', 'no internet', 'spotty wifi', 'weak signal', 'wifi password', 'ask for wifi', 'wifi down'],
  },
  outlet_score: {
    positive: ['outlets', 'outlet', 'charging', 'plug in', 'power outlet', 'charge your', 'lots of outlets', 'plenty of outlets', 'power strip', 'usb port'],
    negative: ['no outlet', 'no outlets', 'no charging', 'can\'t charge', 'limited outlets', 'hard to find outlet', 'not enough outlets'],
  },
  noise_score: {
    positive: ['quiet', 'peaceful', 'calm', 'low noise', 'not loud', 'relaxed', 'tranquil', 'silent', 'easy to work', 'great for work', 'good for work', 'can focus'],
    negative: ['loud', 'noisy', 'too loud', 'crowded', 'can\'t concentrate', 'hard to work', 'can\'t hear', 'blasting music', 'loud music'],
  },
  seating_score: {
    positive: ['comfortable', 'cozy', 'great seating', 'good seating', 'comfy chairs', 'spacious', 'plenty of seating', 'lots of seats', 'plenty of space', 'big tables', 'comfortable chairs'],
    negative: ['uncomfortable', 'cramped', 'no seating', 'hard chairs', 'wobbly table', 'small tables', 'no space', 'standing room'],
  },
  late_night_score: {
    positive: ['open late', '24 hours', '24/7', 'all night', 'midnight', '1am', '2am', '3am', '4am', 'late night', 'stays open', 'night owl', 'always open', 'open 24', 'open all night', 'never closes', 'open till late'],
    negative: ['closes early', 'closes at 5', 'closes at 6', 'not open late', 'short hours', 'closed by evening', 'closes at 7', 'closes at 8'],
  },
}

function scoreKeywords(text: string, positive: string[], negative: string[]): number {
  let score = 5.0  // neutral start

  const positiveHits = positive.filter((kw) => text.includes(kw)).length
  const negativeHits = negative.filter((kw) => text.includes(kw)).length

  score += positiveHits * 0.8
  score -= negativeHits * 1.2

  // Clamp to [2, 9.5]
  return Math.min(9.5, Math.max(2.0, Math.round(score * 10) / 10))
}

export function scoreFromReviews(
  reviews: GPReview[],
  place: GPPlace
): WorkScores {
  const allText = reviews
    .filter((r) => r.text?.languageCode === 'en' || !r.text?.languageCode)
    .map((r) => r.text?.text ?? '')
    .join(' ')
    .toLowerCase()

  const hasText = allText.length > 50

  // If no English reviews, use Google rating as proxy
  const ratingProxy = place.rating ? (place.rating / 5) * 7 + 2 : 5.0

  const wifi = hasText ? scoreKeywords(allText, RULES.wifi_score.positive, RULES.wifi_score.negative) : ratingProxy
  const outlet = hasText ? scoreKeywords(allText, RULES.outlet_score.positive, RULES.outlet_score.negative) : ratingProxy - 1
  const noise = hasText ? scoreKeywords(allText, RULES.noise_score.positive, RULES.noise_score.negative) : ratingProxy
  const seating = hasText ? scoreKeywords(allText, RULES.seating_score.positive, RULES.seating_score.negative) : ratingProxy
  const lateNight = hasText ? scoreKeywords(allText, RULES.late_night_score.positive, RULES.late_night_score.negative) : 5.0

  // Boost late_night_score from hours if place is actually open late
  const hours = convertHours(place.regularOpeningHours)
  const lateNightBoosted = boostLateNightFromHours(lateNight, hours)

  // work_score = weighted combo of wifi + outlets + seating, adjusted by rating
  const workBase = (wifi * 0.35 + outlet * 0.35 + seating * 0.30)
  const ratingBoost = place.rating ? (place.rating - 3) * 0.4 : 0
  const work = Math.min(9.8, Math.max(2.0, Math.round((workBase + ratingBoost) * 10) / 10))

  return {
    wifi_score: Math.round(wifi * 10) / 10,
    outlet_score: Math.round(outlet * 10) / 10,
    noise_score: Math.round(noise * 10) / 10,
    seating_score: Math.round(seating * 10) / 10,
    late_night_score: Math.round(lateNightBoosted * 10) / 10,
    work_score: Math.round(work * 10) / 10,
  }
}

function boostLateNightFromHours(
  baseScore: number,
  hours: Record<string, { open: string; close: string } | null> | null
): number {
  if (!hours) return baseScore

  const closeTimes = Object.values(hours)
    .filter(Boolean)
    .map((h) => {
      const [hr] = h!.close.split(':').map(Number)
      // treat 00:00 or 23:59 as midnight+
      return h!.close === '23:59' || h!.close === '00:00' ? 24 : hr
    })

  if (closeTimes.length === 0) return baseScore

  const avgClose = closeTimes.reduce((a, b) => a + b, 0) / closeTimes.length
  const maxClose = Math.max(...closeTimes)

  let boost = 0
  if (maxClose >= 24) boost = 4.0      // 24hr
  else if (maxClose >= 2) boost = 3.5  // past 2am
  else if (maxClose >= 0) boost = 2.5  // past midnight
  else if (maxClose >= 22) boost = 1.5 // past 10pm
  else if (maxClose >= 21) boost = 0.5 // past 9pm
  else boost = -1.0                    // closes before 9pm

  return Math.min(9.9, Math.max(1.0, (baseScore + boost) / 2 + boost * 0.3))
}

// ── Noise level from reviews text ─────────────────────────────

export function noiseLevelFromText(text: string): 'silent' | 'quiet' | 'moderate' | 'loud' {
  const t = text.toLowerCase()
  const loudCount = ['loud', 'noisy', 'rowdy', 'crowded', 'chaotic'].filter((w) => t.includes(w)).length
  const quietCount = ['quiet', 'silent', 'peaceful', 'calm', 'tranquil', 'serene'].filter((w) => t.includes(w)).length

  if (loudCount > 2) return 'loud'
  if (loudCount > quietCount) return 'moderate'
  if (quietCount > 1) return 'quiet'
  return 'moderate'
}

// ── Seating comfort from reviews + price level ────────────────

export function seatingComfortFromData(
  reviews: GPReview[],
  priceLevel?: string
): 'poor' | 'fair' | 'good' | 'excellent' {
  const text = reviews.map((r) => r.text?.text ?? '').join(' ').toLowerCase()

  if (
    text.includes('excellent') || text.includes('luxurious') || text.includes('very comfortable') ||
    priceLevel === 'PRICE_LEVEL_VERY_EXPENSIVE'
  ) return 'excellent'

  if (
    text.includes('comfortable') || text.includes('cozy') || text.includes('comfy') ||
    priceLevel === 'PRICE_LEVEL_EXPENSIVE'
  ) return 'good'

  if (text.includes('uncomfortable') || text.includes('hard') || text.includes('cramped')) return 'poor'

  return 'fair'
}

// ── Vibe tags from reviews + place data ──────────────────────

export function vibeTagsFromPlace(place: GPPlace, reviews: GPReview[]): string[] {
  const tags = new Set<string>()
  const text = reviews.map((r) => r.text?.text ?? '').join(' ').toLowerCase()
  const hours = convertHours(place.regularOpeningHours)

  // Hours-based
  const is24h = Object.values(hours ?? {}).every(
    (h) => h && (h.close === '23:59' || h.close === '00:00')
  )
  if (is24h) tags.add('24hr')

  const maxClose = Math.max(
    ...Object.values(hours ?? {}).filter(Boolean).map((h) => {
      const [hr] = h!.close.split(':').map(Number)
      return h!.close === '23:59' || h!.close === '00:00' ? 24 : hr
    })
  )
  if (maxClose >= 2 && !is24h) tags.add('open till 2am+')
  else if (maxClose >= 0 && !is24h) tags.add('open past midnight')

  // Review-based
  if (text.includes('wifi') || text.includes('wi-fi')) tags.add('good wifi')
  if (text.includes('outlet') || text.includes('charging')) tags.add('outlets')
  if (text.includes('quiet') || text.includes('peaceful')) tags.add('quiet')
  if (text.includes('cozy') || text.includes('comfortable')) tags.add('cozy')
  if (text.includes('laptop') || text.includes('work')) tags.add('laptop friendly')
  if (text.includes('student') || text.includes('studying')) tags.add('student friendly')
  if (text.includes('outdoor') || text.includes('patio') || text.includes('terrace')) tags.add('outdoor seating')
  if (text.includes('cash only')) tags.add('cash only')
  if (text.includes('crowded') || text.includes('busy')) tags.add('busy')
  if (text.includes('never crowded') || text.includes('not crowded')) tags.add('not crowded')

  // Type-based
  const type = mapPlaceType(place.types ?? [])
  if (type === 'hotel_lobby') tags.add('hotel lobby')
  if (type === 'bar') tags.add('bar vibes')
  if (type === 'diner') tags.add('diner')

  // Price-based
  if (place.priceLevel === 'PRICE_LEVEL_FREE') tags.add('free entry')
  if (place.priceLevel === 'PRICE_LEVEL_VERY_EXPENSIVE') tags.add('upscale')

  return [...tags].slice(0, 6)
}
