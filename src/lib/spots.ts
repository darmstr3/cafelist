import { supabase, supabaseAdmin, isSupabaseConfigured } from './supabase'
import { Spot, SpotFilters, Review } from '@/types'
import { isOpenNow, isOpenLate, isOpenAfterMidnight } from './utils'
import { DEMO_SPOTS, DEMO_CITIES } from './demo-data'
import { PUBLIC_WORKABILITY_FLOOR } from './quality'

// ── Fetch all approved spots (with filters) ───────────────────

export interface SpotsResult {
  spots: Spot[]
  /** True when the underlying data source threw — surfaces a "service temporarily
   * unavailable" UI instead of an empty-state UI that implies we have no data. */
  serviceError: boolean
}

export interface GetSpotsOptions {
  /**
   * Minimum workability_score required for a spot to be returned.
   * Defaults to the public floor (PUBLIC_WORKABILITY_FLOOR). Rows below
   * this are excluded; so are rows with a NULL (unscored) workability_score
   * unless `includeUnscored` is set.
   */
  minWorkability?: number
  /**
   * Include rows whose workability_score is NULL (unscored Scout rows in
   * the window before the daily Curator catches them). Public surfaces keep
   * this false so unvetted spots never publish. The /find retriever opts in
   * so it can run its own two-stage strict→relaxed filtering over the wider
   * candidate pool.
   */
  includeUnscored?: boolean
}

export async function getSpots(
  filters?: Partial<SpotFilters>,
  opts?: GetSpotsOptions,
): Promise<SpotsResult> {
  const minWorkability = opts?.minWorkability ?? PUBLIC_WORKABILITY_FLOOR
  const includeUnscored = opts?.includeUnscored ?? false

  if (!isSupabaseConfigured()) {
    return {
      spots: filterDemoSpots(DEMO_SPOTS, filters, { minWorkability, includeUnscored }),
      serviceError: false,
    }
  }

  let query = supabase
    .from('spots')
    .select('*')
    .eq('status', 'approved')
    .order('work_score', { ascending: false })

  // ── Public quality gate ──────────────────────────────────────
  // Only surface spots the Curator judged workable. `.gte` excludes
  // NULLs in Postgres, which is exactly what we want for the public
  // default. When a caller opts into unscored rows, broaden to
  // "score >= floor OR score IS NULL".
  if (includeUnscored) {
    query = query.or(
      `workability_score.gte.${minWorkability},workability_score.is.null`,
    )
  } else {
    query = query.gte('workability_score', minWorkability)
  }

  if (filters?.city && filters.city !== '') {
    query = query.ilike('city', `%${filters.city}%`)
  }

  if (filters?.search && filters.search !== '') {
    query = query.or(
      `name.ilike.%${filters.search}%,city.ilike.%${filters.search}%,neighborhood.ilike.%${filters.search}%`
    )
  }

  if (filters?.hasWifi) query = query.eq('has_wifi', true)
  if (filters?.hasOutlets) query = query.eq('has_outlets', true)
  if (filters?.laptopFriendly) query = query.eq('laptop_friendly', true)
  if (filters?.hasBathroom) query = query.eq('has_bathroom', true)
  if (filters?.hasFood) query = query.eq('has_food', true)
  if (filters?.hasDrinks) query = query.eq('has_drinks', true)
  if (filters?.noiseLevel) query = query.eq('noise_level', filters.noiseLevel)
  if (filters?.type) query = query.eq('type', filters.type)
  if (filters?.minWorkScore) query = query.gte('work_score', filters.minWorkScore)
  if (filters?.minLateNightScore) query = query.gte('late_night_score', filters.minLateNightScore)

  let data, error
  try {
    const result = await query
    data = result.data
    error = result.error
  } catch (e) {
    // Network/timeout errors throw rather than return as { error }
    console.error('getSpots threw:', e)
    return { spots: [], serviceError: true }
  }

  if (error) {
    console.error('getSpots error:', error)
    return { spots: [], serviceError: true }
  }

  let spots = (data ?? []) as Spot[]

  if (filters?.openNow) spots = spots.filter((s) => isOpenNow(s.hours))
  if (filters?.openLate) spots = spots.filter((s) => isOpenLate(s.hours))
  if (filters?.openAfter9pm) spots = spots.filter((s) => isOpenLate(s.hours))
  if (filters?.openAfterMidnight) spots = spots.filter((s) => isOpenAfterMidnight(s.hours))

  return { spots, serviceError: false }
}

// ── Client-side demo filter (mirrors DB-level filters) ────────

function filterDemoSpots(
  spots: Spot[],
  filters?: Partial<SpotFilters>,
  opts?: GetSpotsOptions,
): Spot[] {
  const minWorkability = opts?.minWorkability ?? PUBLIC_WORKABILITY_FLOOR
  const includeUnscored = opts?.includeUnscored ?? false

  // Mirror the DB-level public quality gate before any other filtering.
  let results = [...spots]
    .filter((s) => {
      if (s.workability_score == null) return includeUnscored
      return s.workability_score >= minWorkability
    })
    .sort((a, b) => b.work_score - a.work_score)

  if (!filters) return results

  const q = filters.search?.toLowerCase() ?? ''
  if (q) {
    results = results.filter((s) => {
      const hay = `${s.name} ${s.city} ${s.neighborhood ?? ''} ${s.type}`.toLowerCase()
      return hay.includes(q)
    })
  }

  if (filters.city) results = results.filter((s) => s.city.toLowerCase().includes(filters.city!.toLowerCase()))
  if (filters.type) results = results.filter((s) => s.type === filters.type)
  if (filters.hasWifi) results = results.filter((s) => s.has_wifi)
  if (filters.hasOutlets) results = results.filter((s) => s.has_outlets)
  if (filters.laptopFriendly) results = results.filter((s) => s.laptop_friendly)
  if (filters.hasBathroom) results = results.filter((s) => s.has_bathroom)
  if (filters.hasFood) results = results.filter((s) => s.has_food)
  if (filters.hasDrinks) results = results.filter((s) => s.has_drinks)
  if (filters.noiseLevel) results = results.filter((s) => s.noise_level === filters.noiseLevel)
  if (filters.minWorkScore) results = results.filter((s) => s.work_score >= filters.minWorkScore!)
  if (filters.minLateNightScore) results = results.filter((s) => s.late_night_score >= filters.minLateNightScore!)
  if (filters.openNow) results = results.filter((s) => isOpenNow(s.hours))
  if (filters.openLate) results = results.filter((s) => isOpenLate(s.hours))
  if (filters.openAfter9pm) results = results.filter((s) => isOpenLate(s.hours))
  if (filters.openAfterMidnight) results = results.filter((s) => isOpenAfterMidnight(s.hours))

  return results
}

// ── Fetch single spot by slug ─────────────────────────────────

export async function getSpotBySlug(slug: string): Promise<Spot | null> {
  if (!isSupabaseConfigured()) {
    return DEMO_SPOTS.find((s) => s.slug === slug) ?? null
  }

  const { data, error } = await supabase
    .from('spots')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'approved')
    .single()

  if (error) return null
  return data as Spot
}

// ── Fetch spot by id (admin) ──────────────────────────────────

export async function getSpotById(id: string): Promise<Spot | null> {
  if (!isSupabaseConfigured()) {
    return DEMO_SPOTS.find((s) => s.id === id) ?? null
  }

  const { data, error } = await supabaseAdmin
    .from('spots')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return null
  return data as Spot
}

// ── Fetch reviews for a spot ──────────────────────────────────

export async function getReviewsBySpotId(spotId: string): Promise<Review[]> {
  if (!isSupabaseConfigured()) return []

  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('spot_id', spotId)
    .eq('status', 'approved')
    .order('created_at', { ascending: false })

  if (error) return []
  return (data ?? []) as Review[]
}

// ── Admin: fetch all spots ────────────────────────────────────

export async function adminGetAllSpots(): Promise<Spot[]> {
  if (!isSupabaseConfigured()) return DEMO_SPOTS

  const { data, error } = await supabaseAdmin
    .from('spots')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return []
  return (data ?? []) as Spot[]
}

// ── Admin: fetch recent scout runs ────────────────────────────

export interface ScoutRunRow {
  run_id: string
  started_at: string
  finished_at: string | null
  city: string | null
  neighborhood: string | null
  candidates_examined: number
  candidates_inserted: number
  total_cost_usd: number
  status: 'running' | 'success' | 'partial' | 'skipped' | 'error' | 'cap_hit'
  error_message: string | null
  notes: string | null
}

export async function adminGetScoutRuns(limit = 50): Promise<ScoutRunRow[]> {
  if (!isSupabaseConfigured()) return []

  const { data, error } = await supabaseAdmin
    .from('scout_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('adminGetScoutRuns error:', error)
    return []
  }
  return (data ?? []) as ScoutRunRow[]
}

// ── Admin: fetch all reviews ──────────────────────────────────

export async function adminGetAllReviews(): Promise<(Review & { spot_name?: string })[]> {
  if (!isSupabaseConfigured()) return []

  const { data, error } = await supabaseAdmin
    .from('reviews')
    .select('*, spots(name)')
    .order('created_at', { ascending: false })

  if (error) return []
  return (data ?? []).map((r: Review & { spots?: { name: string } }) => ({
    ...r,
    spot_name: r.spots?.name,
  }))
}

// ── Submit a new spot ─────────────────────────────────────────

export async function submitSpot(payload: Partial<Spot>): Promise<{ id: string } | null> {
  if (!isSupabaseConfigured()) {
    // In demo mode, just return a fake ID
    return { id: `demo-${Date.now()}` }
  }

  const { data, error } = await supabase
    .from('spots')
    .insert({ ...payload, status: 'pending' })
    .select('id')
    .single()

  if (error) {
    console.error('submitSpot error:', error)
    return null
  }
  return data
}

// ── Submit a review ───────────────────────────────────────────

export async function submitReview(payload: Partial<Review>): Promise<boolean> {
  if (!isSupabaseConfigured()) return true

  const { error } = await supabase
    .from('reviews')
    .insert({ ...payload, status: 'pending' })

  if (error) {
    console.error('submitReview error:', error)
    return false
  }
  return true
}

// ── Admin: approve/reject ─────────────────────────────────────

export async function adminUpdateSpotStatus(id: string, status: 'approved' | 'rejected'): Promise<boolean> {
  if (!isSupabaseConfigured()) return true
  const patch: Record<string, unknown> = { status }
  // Auto-stamp verification time when a spot is approved so we can
  // later flag stale rows (re-verification agent).
  if (status === 'approved') patch.last_verified_at = new Date().toISOString()
  const { error } = await supabaseAdmin.from('spots').update(patch).eq('id', id)
  return !error
}

// ── Admin: edit any field on a spot ───────────────────────────
// Whitelist of fields the admin UI is allowed to write. Anything
// outside this list (id, slug, google_place_id, address, photos,
// hours, lat/lng, etc.) is read-only and comes from Google Places.
const EDITABLE_SPOT_FIELDS = new Set<string>([
  'neighborhood',
  'work_score', 'late_night_score', 'wifi_score',
  'outlet_score', 'noise_score', 'seating_score',
  'has_wifi', 'has_outlets', 'laptop_friendly',
  'has_bathroom', 'has_food', 'has_drinks',
  'noise_level', 'seating_comfort',
  'vibe_tags', 'notes',
  'status', 'last_verified_at',
])

export async function adminUpdateSpot(
  id: string,
  patch: Partial<Spot>
): Promise<boolean> {
  if (!isSupabaseConfigured()) return true

  // Filter to whitelist
  const safe: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) {
    if (EDITABLE_SPOT_FIELDS.has(k)) safe[k] = v
  }

  // If status is being set to approved, auto-stamp last_verified_at
  // (only if the caller didn't explicitly set it).
  if (safe.status === 'approved' && safe.last_verified_at === undefined) {
    safe.last_verified_at = new Date().toISOString()
  }

  if (Object.keys(safe).length === 0) return true

  const { error } = await supabaseAdmin.from('spots').update(safe).eq('id', id)
  return !error
}

export async function adminUpdateReviewStatus(id: string, status: 'approved' | 'rejected'): Promise<boolean> {
  if (!isSupabaseConfigured()) return true
  const { error } = await supabaseAdmin.from('reviews').update({ status }).eq('id', id)
  return !error
}

// ── Get unique cities ─────────────────────────────────────────

export async function getCities(): Promise<string[]> {
  if (!isSupabaseConfigured()) return DEMO_CITIES

  const { data } = await supabase
    .from('spots')
    .select('city')
    .eq('status', 'approved')

  if (!data) return []
  const cities = [...new Set(data.map((r: { city: string }) => r.city))].sort()
  return cities
}
