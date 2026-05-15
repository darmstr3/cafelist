import { runActor } from '../apify'

// ── Raw types from apify/yelp-scraper ─────────────────────────

interface RawYelpReview {
  text?: string
  rating?: number
  date?: string
}

export interface RawYelpPlace {
  name?: string
  address?: string
  rating?: number
  reviewCount?: number
  reviews?: RawYelpReview[]
  url?: string
  priceRange?: string
  categories?: string[]
}

// ── Work-relevant review keywords ─────────────────────────────
// We filter Yelp reviews to only those mentioning work-relevant keywords
// so we focus signal analysis on the subset that matters

const WORK_KEYWORDS = [
  'wifi', 'wi-fi', 'internet',
  'laptop', 'remote', 'work',
  'outlet', 'charging', 'plug',
  'quiet', 'peaceful', 'calm',
  'loud', 'noisy',
  'study', 'focus',
]

function isWorkRelevant(text: string): boolean {
  const lower = text.toLowerCase()
  return WORK_KEYWORDS.some((kw) => lower.includes(kw))
}

// ── Runner ────────────────────────────────────────────────────

export async function scrapeYelp(city: string): Promise<RawYelpPlace[]> {
  const results = await runActor<RawYelpPlace>({
    actorId: 'tri_angle/yelp-scraper',
    input: {
      searchTerms: ['coffee shops', 'cafe'],
      locations: [city],
      searchLimit: 25,
    },
    timeoutSecs: 300,
    memoryMbytes: 512,
    maxItems: 200,
  })

  // Filter each place's reviews to work-relevant only, keeping places with
  // at least one relevant review
  return results
    .filter((p) => p.name)
    .map((place) => ({
      ...place,
      reviews: (place.reviews ?? []).filter(
        (r) => r.text && isWorkRelevant(r.text)
      ),
    }))
    .filter((p) => (p.reviews?.length ?? 0) > 0 || (p.rating ?? 0) > 0)
}
