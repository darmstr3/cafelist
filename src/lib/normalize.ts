import { CafeRecord, CafeHours, DayName } from '@/types/cafe'
import { RawGMPlace } from './actors/google-maps'
import { RawYelpPlace } from './actors/yelp'
import { RawRedditPost } from './actors/reddit'
import { scoreCafe, buildTopSignals } from './scorer'

// ── Name normalization for fuzzy matching ─────────────────────

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\b(the|a|an|coffee|cafe|shop|roasters?|house|co)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

// ── Hours parsing ─────────────────────────────────────────────

const DAY_LABELS: DayName[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function parseGMHours(
  rawHours: Array<{ day: string; hours: string }> | undefined
): CafeHours {
  if (!rawHours?.length) return {}

  const result: CafeHours = {}
  for (const entry of rawHours) {
    const dayKey = DAY_LABELS.find((d) =>
      entry.day?.toLowerCase().startsWith(d.toLowerCase().slice(0, 3))
    )
    if (dayKey) {
      result[dayKey] = entry.hours === 'Closed' ? null : entry.hours
    }
  }
  return result
}

// ── ID / slug ─────────────────────────────────────────────────

function makeId(name: string, city: string): string {
  return [name, city]
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// ── Neighborhood extraction ───────────────────────────────────

const NEIGHBORHOODS_NYC = [
  'Greenwich Village', 'East Village', 'West Village', 'SoHo', 'Tribeca',
  'Lower East Side', 'Chinatown', 'Nolita', 'Financial District', 'Flatiron',
  'Chelsea', 'Midtown', 'Hell\'s Kitchen', 'Upper West Side', 'Upper East Side',
  'Harlem', 'Washington Heights', 'Williamsburg', 'Bushwick', 'Greenpoint',
  'Park Slope', 'DUMBO', 'Crown Heights', 'Bed-Stuy', 'Astoria',
  'Long Island City', 'Jackson Heights', 'Flushing',
]

function extractNeighborhood(address: string, city: string): string | null {
  // Try NYC neighborhoods
  if (city.toLowerCase().includes('new york') || city.toLowerCase().includes('nyc')) {
    for (const n of NEIGHBORHOODS_NYC) {
      if (address.toLowerCase().includes(n.toLowerCase())) return n
    }
  }
  return null
}

// ── Review sample picker ──────────────────────────────────────
// Pick 3–5 short reviews that mention work-relevant keywords

const RELEVANT_KWS = ['wifi', 'outlet', 'quiet', 'loud', 'laptop', 'work', 'charging', 'internet']

function pickReviewSamples(reviews: string[], max = 5): string[] {
  const relevant = reviews
    .filter((r) => r.length > 30 && RELEVANT_KWS.some((kw) => r.toLowerCase().includes(kw)))
    .sort((a, b) => a.length - b.length)   // prefer shorter, more readable
    .slice(0, max)
    .map((r) => r.slice(0, 280))           // trim to 280 chars

  if (relevant.length >= 3) return relevant

  // Fall back to first N reviews if not enough relevant ones
  return reviews.slice(0, max).map((r) => r.slice(0, 280))
}

// ── Main normalizer ───────────────────────────────────────────

export function normalizePlaces(
  city: string,
  gmPlaces: RawGMPlace[],
  yelpPlaces: RawYelpPlace[],
  redditPosts: RawRedditPost[]
): CafeRecord[] {
  // Collect all Reddit text as city-level context
  const redditText = redditPosts
    .flatMap((p) => [
      p.title ?? '',
      p.body ?? '',
      ...(p.comments ?? []).map((c) => c.body ?? ''),
    ])
    .join(' ')

  const records: CafeRecord[] = []

  for (const place of gmPlaces) {
    if (!place.title) continue

    const name = place.title
    const address = place.address ?? ''
    const hours = parseGMHours(place.openingHours)

    // Collect all reviews from Google Maps
    const gmReviews = (place.reviews ?? [])
      .map((r) => r.text ?? '')
      .filter(Boolean)

    // Find matching Yelp place by name
    const yelpMatch = yelpPlaces.find((y) => y.name && namesMatch(name, y.name))
    const yelpReviews = (yelpMatch?.reviews ?? [])
      .map((r) => r.text ?? '')
      .filter(Boolean)

    // Combine all review text
    const allReviews = [...gmReviews, ...yelpReviews]

    // Weighted rating: Google (weighted 70%) + Yelp (30%)
    const gmRating = place.totalScore ?? 0
    const yelpRating = yelpMatch?.rating ?? 0
    const rating = yelpRating > 0
      ? gmRating * 0.7 + yelpRating * 0.3
      : gmRating

    // Score
    const scored = scoreCafe({ allReviews, rating, hours })
    const topSignals = buildTopSignals(scored.breakdown, hours)

    // Photos: resize to 800×500 so cards load fast (Google supports URL size params)
    const photos = (place.imageUrls ?? [])
      .slice(0, 3)
      .map((url) => url.replace(/=w\d+-h\d+(-[a-z-]*)?$/, '=w800-h500-k-no'))

    const id = makeId(name, city)

    records.push({
      id,
      name,
      address,
      neighborhood: extractNeighborhood(address, city),
      city,
      lat: place.location?.lat ?? null,
      lng: place.location?.lng ?? null,
      rating: Math.round(rating * 10) / 10,
      reviewCount: (place.reviewsCount ?? 0) + (yelpMatch?.reviewCount ?? 0),
      photos,
      googleMapsUrl: place.url ?? null,
      website: place.website ?? null,
      hours,
      score: scored.breakdown,
      wifiMentions: scored.wifiMentions,
      outletMentions: scored.outletMentions,
      quietMentions: scored.quietMentions,
      loudMentions: scored.loudMentions,
      laptopMentions: scored.laptopMentions,
      topSignals,
      reviewSamples: pickReviewSamples(allReviews),
      sources: [
        'google_maps',
        ...(yelpMatch ? ['yelp' as const] : []),
        ...(redditText.length > 100 ? ['reddit' as const] : []),
      ],
    })
  }

  // Deduplicate by id (can happen if Google returns same place from multiple queries)
  const seen = new Set<string>()
  const deduped = records.filter((r) => {
    if (seen.has(r.id)) return false
    seen.add(r.id)
    return true
  })

  // Sort by total score descending
  return deduped.sort((a, b) => b.score.total - a.score.total)
}
