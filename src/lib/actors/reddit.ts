import { runActor } from '../apify'

// ── Raw types from apify/reddit-scraper ───────────────────────

interface RawRedditComment {
  body?: string
  score?: number
}

export interface RawRedditPost {
  title?: string
  body?: string
  url?: string
  score?: number
  numComments?: number
  subreddit?: string
  comments?: RawRedditComment[]
}

// ── Build search URLs ─────────────────────────────────────────

function citySlug(city: string): string {
  return city.toLowerCase().replace(/\s+/g, '+')
}

function citySubreddit(city: string): string {
  // Best-effort: map common cities to subreddits
  const map: Record<string, string> = {
    'new york city': 'nyc',
    'new york': 'nyc',
    'nyc': 'nyc',
    'los angeles': 'LosAngeles',
    'la': 'LosAngeles',
    'san francisco': 'sanfrancisco',
    'sf': 'sanfrancisco',
    'chicago': 'chicago',
    'austin': 'Austin',
    'seattle': 'Seattle',
    'boston': 'boston',
    'miami': 'miami',
    'denver': 'Denver',
    'portland': 'Portland',
    'nashville': 'nashville',
    'atlanta': 'Atlanta',
    'washington dc': 'washingtondc',
    'dc': 'washingtondc',
    'london': 'london',
    'toronto': 'toronto',
    'berlin': 'berlin',
    'amsterdam': 'Amsterdam',
    'lisbon': 'lisboa',
    'barcelona': 'barcelona',
    'paris': 'paris',
  }
  return map[city.toLowerCase()] ?? city.toLowerCase().replace(/\s+/g, '')
}

// ── Runner ────────────────────────────────────────────────────

export async function scrapeReddit(city: string): Promise<RawRedditPost[]> {
  const slug = citySlug(city)
  const subreddit = citySubreddit(city)

  const urls = [
    // Global work/nomad communities searching for this city
    `https://www.reddit.com/search/?q=${slug}+coffee+shop+work+laptop&sort=relevance&t=year`,
    `https://www.reddit.com/r/digitalnomad/search/?q=${slug}+coffee+cafe&sort=relevance&t=year&restrict_sr=1`,
    `https://www.reddit.com/r/remotework/search/?q=${slug}+cafe+wifi&sort=relevance&t=year&restrict_sr=1`,
    // City-specific subreddit
    `https://www.reddit.com/r/${subreddit}/search/?q=coffee+shop+work+laptop+wifi&sort=relevance&t=year&restrict_sr=1`,
  ]

  try {
    const results = await runActor<RawRedditPost>({
      actorId: 'trudax/reddit-scraper-lite',
      input: {
        startUrls: urls.map((url) => ({ url })),
        maxItems: 40,
        maxPostCount: 40,
        maxComments: 10,
        proxy: { useApifyProxy: true },
      },
      timeoutSecs: 120,
      memoryMbytes: 256,
      maxItems: 100,
    })

    return results.filter((p) => p.title || p.body)
  } catch (err) {
    // Reddit scraper is optional — don't fail the whole search if it errors
    console.warn('[reddit] Scraper failed (optional source):', err instanceof Error ? err.message : err)
    return []
  }
}
