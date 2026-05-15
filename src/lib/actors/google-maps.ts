import { runActor } from '../apify'

// ── Raw types from apify/google-maps-scraper ──────────────────

interface RawGMReview {
  text?: string
  rating?: number
  likesCount?: number
  reviewUrl?: string
}

interface RawGMHours {
  day: string
  hours: string
}

export interface RawGMPlace {
  title?: string
  address?: string
  location?: { lat: number; lng: number }
  totalScore?: number
  reviewsCount?: number
  imageUrls?: string[]
  openingHours?: RawGMHours[]
  reviews?: RawGMReview[]
  url?: string
  website?: string
  neighborhood?: string
  permanentlyClosed?: boolean
  temporarilyClosed?: boolean
}

// ── Runner ────────────────────────────────────────────────────

export async function scrapeGoogleMaps(city: string): Promise<RawGMPlace[]> {
  // For NYC, target Manhattan specifically so we get well-known spots
  // instead of outer borough results
  const lower = city.toLowerCase()
  const locationQuery =
    lower.includes('new york') || lower === 'nyc'
      ? 'Manhattan, New York City, NY'
      : city

  const results = await runActor<RawGMPlace>({
    actorId: 'compass/crawler-google-places',
    input: {
      searchStringsArray: ['best coffee shop to work', 'popular cafe laptop wifi'],
      locationQuery,
      maxCrawledPlacesPerSearch: 20,
      maxReviews: 20,
      language: 'en',
      maxImages: 3,
      exportPlaceUrls: false,
      additionalInfo: false,
    },
    timeoutSecs: 300,
    memoryMbytes: 1024,
    maxItems: 400,
  })

  // Filter out permanently closed places
  return results.filter(
    (p) => !p.permanentlyClosed && !p.temporarilyClosed && p.title
  )
}
