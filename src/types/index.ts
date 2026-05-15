export type SpotType =
  | 'coffee_shop'
  | 'hotel_lobby'
  | 'diner'
  | 'bar'
  | 'library'
  | 'coworking'
  | 'other'

export type NoiseLevel = 'silent' | 'quiet' | 'moderate' | 'loud'
export type SeatingComfort = 'poor' | 'fair' | 'good' | 'excellent'
export type SpotStatus = 'pending' | 'approved' | 'rejected'
export type ReviewStatus = 'pending' | 'approved' | 'rejected'

export type DayHours = { open: string; close: string } | null

export interface SpotHours {
  monday?: DayHours
  tuesday?: DayHours
  wednesday?: DayHours
  thursday?: DayHours
  friday?: DayHours
  saturday?: DayHours
  sunday?: DayHours
}

export interface SpotPhoto {
  url: string
  caption?: string
}

export interface Spot {
  id: string
  name: string
  slug: string
  type: SpotType
  address: string
  city: string
  neighborhood: string | null
  lat: number | null
  lng: number | null
  google_place_id: string | null
  photos: SpotPhoto[]
  hours: SpotHours | null
  work_score: number
  late_night_score: number
  wifi_score: number
  outlet_score: number
  noise_score: number
  seating_score: number
  has_wifi: boolean
  has_outlets: boolean
  laptop_friendly: boolean
  has_bathroom: boolean
  has_food: boolean
  has_drinks: boolean
  noise_level: NoiseLevel | null
  seating_comfort: SeatingComfort | null
  vibe_tags: string[]
  notes: string | null
  status: SpotStatus
  submitted_by: string | null
  last_verified_at: string | null
  // Curator Agent output — see scripts/curate-workability.ts.
  // workability_score is a 0–10 "can a remote worker camp here 2+ hrs"
  // assessment, separate from work_score (which is review-driven and
  // covers wifi/outlets/seating quality but not vibe/pressure-to-leave).
  // Nullable because new rows from Scout start unscored.
  workability_score: number | null
  workability_reasoning: string | null
  workability_scored_at: string | null
  created_at: string
  updated_at: string
}

export interface Review {
  id: string
  spot_id: string
  author_name: string
  author_email: string | null
  wifi_rating: number | null
  outlet_rating: number | null
  noise_rating: number | null
  seating_rating: number | null
  late_night_rating: number | null
  comment: string | null
  status: ReviewStatus
  created_at: string
}

// ── Filter State ─────────────────────────────────────────────

export interface SpotFilters {
  search: string
  city: string
  neighborhood: string     // e.g. 'SoHo', 'Williamsburg', '' = all
  openNow: boolean
  openLate: boolean        // closes after 21:00
  openAfter9pm: boolean
  openAfterMidnight: boolean
  hasWifi: boolean
  hasOutlets: boolean
  laptopFriendly: boolean
  hasBathroom: boolean
  hasFood: boolean
  hasDrinks: boolean
  noiseLevel: NoiseLevel | ''
  minWorkScore: number
  minLateNightScore: number
  type: SpotType | ''
}

// ── Submit Form ───────────────────────────────────────────────

export interface SubmitSpotForm {
  name: string
  type: SpotType
  address: string
  city: string
  neighborhood: string
  notes: string
  submitted_by: string
  wifi_rating: number
  outlet_rating: number
  noise_rating: number
  seating_rating: number
  late_night_rating: number
}

// ── API Response ──────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T | null
  error: string | null
}

export interface SpotsResponse {
  spots: Spot[]
  total: number
  page: number
  perPage: number
}
