// ── Score breakdown ───────────────────────────────────────────

export interface ScoreBreakdown {
  wifi: number      // 0–30
  outlets: number   // 0–20
  noise: number     // 0–20  (higher = quieter = better)
  rating: number    // 0–15
  hours: number     // 0–15
  total: number     // 0–100
}

// ── Hours ─────────────────────────────────────────────────────

export type DayName = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday'
export type CafeHours = Partial<Record<DayName, string | null>>  // e.g. { Monday: "7 AM–10 PM" }

// ── Signal ────────────────────────────────────────────────────

export type SignalType = 'wifi' | 'outlets' | 'quiet' | 'open_late' | 'highly_rated' | 'laptop_friendly' | 'noisy' | 'no_wifi'

export interface Signal {
  type: SignalType
  label: string
  icon: string
  positive: boolean
}

// ── Cafe record ───────────────────────────────────────────────

export interface CafeRecord {
  id: string                  // slugified name + city
  name: string
  address: string
  neighborhood: string | null
  city: string
  lat: number | null
  lng: number | null

  // Aggregated from sources
  rating: number              // 1–5 (weighted avg from all sources)
  reviewCount: number
  photos: string[]
  googleMapsUrl: string | null
  website: string | null
  hours: CafeHours

  // Scored
  score: ScoreBreakdown

  // Raw signal counts (used for score + display)
  wifiMentions: number
  outletMentions: number
  quietMentions: number
  loudMentions: number
  laptopMentions: number

  // Top 3 signals shown on card
  topSignals: Signal[]

  // Sample reviews shown in breakdown
  reviewSamples: string[]

  // Which actors contributed data
  sources: Array<'google_maps' | 'yelp' | 'reddit'>
}

// ── Cache ─────────────────────────────────────────────────────

export interface CityCache {
  city: string
  citySlug: string
  cafes: CafeRecord[]
  totalFound: number
  cachedAt: string   // ISO timestamp
  sources: string[]
}

// ── API response ──────────────────────────────────────────────

export interface SearchResponse {
  cafes: CafeRecord[]
  city: string
  totalFound: number
  fromCache: boolean
  cachedAt: string | null
  error?: string
  /** 'running' = scrape in progress, poll again; 'done' = results ready */
  status: 'done' | 'running'
}

// ── Filter state ──────────────────────────────────────────────

export interface CafeFilters {
  minScore: number
  openNow: boolean
  neighborhood: string
  sortBy: 'score' | 'rating' | 'name'
}
