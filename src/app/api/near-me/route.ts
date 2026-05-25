/**
 * /api/near-me — return approved spots ordered by distance from a user's
 * lat/lng. Designed for the "leaving a cafe, need a change of scene"
 * scenario: the user gives us their location, we hand back the best
 * workable cafes within a walking radius, crossing neighborhood lines.
 *
 * Privacy posture:
 *   - The lat/lng is only used to compute distances in this single request
 *   - We do NOT persist it server-side
 *   - We do NOT log it to any analytics table
 *   - The browser's geolocation permission gate is the single consent prompt
 *
 * Distance math: Haversine via PostgreSQL. Earth radius 6371000 m.
 *
 * Filters: defaults to workability_score >= 5 (slightly relaxed from the
 * /labs strict >=6 threshold because in-the-moment discovery should err
 * toward more options, with the score visible so the user can choose).
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

interface NearMeRequest {
  lat: number
  lng: number
  /** Search radius in meters. Defaults to 2000 (~25 min walk). */
  radiusMeters?: number
  /** Min workability score. Defaults to 5; pass 0 to disable. */
  minWorkability?: number
  /** Max results. Defaults to 25. */
  limit?: number
}

interface NearMeSpot {
  id: string
  slug: string
  name: string
  type: string
  city: string
  neighborhood: string | null
  lat: number
  lng: number
  workability_score: number | null
  workability_reasoning: string | null
  has_outlets: boolean
  has_wifi: boolean
  laptop_friendly: boolean
  vibe_tags: string[]
  distance_meters: number
  walk_minutes: number
}

function isValidCoord(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

export async function POST(req: NextRequest) {
  let body: NearMeRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!isValidCoord(body.lat) || !isValidCoord(body.lng)) {
    return NextResponse.json(
      { error: 'lat and lng are required and must be numbers' },
      { status: 400 }
    )
  }
  if (body.lat < -90 || body.lat > 90 || body.lng < -180 || body.lng > 180) {
    return NextResponse.json({ error: 'lat/lng out of range' }, { status: 400 })
  }

  const radiusMeters = Math.min(Math.max(body.radiusMeters ?? 2000, 100), 10000)
  const minWorkability = Math.min(Math.max(body.minWorkability ?? 5, 0), 10)
  const limit = Math.min(Math.max(body.limit ?? 25, 1), 100)

  // Pull a candidate set (approved spots with coordinates) then compute
  // distance + filter in JS. 535 rows is small enough that we don't need
  // PostGIS or earthdistance extensions — Haversine in JS is fast and
  // keeps the query simple.
  const { data, error } = await supabase
    .from('spots')
    .select(
      'id, slug, name, type, city, neighborhood, lat, lng, workability_score, workability_reasoning, has_outlets, has_wifi, laptop_friendly, vibe_tags'
    )
    .eq('status', 'approved')
    .not('lat', 'is', null)
    .not('lng', 'is', null)

  if (error) {
    console.error('[near-me] DB error:', error.message)
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }

  const rows = data ?? []
  const results: NearMeSpot[] = []

  for (const r of rows as Array<NearMeSpot & { workability_score: number | null }>) {
    if (r.lat == null || r.lng == null) continue

    const distance = haversineMeters(body.lat, body.lng, Number(r.lat), Number(r.lng))
    if (distance > radiusMeters) continue

    // Filter by workability — but only if the row HAS a workability score.
    // Unscored rows fall through (we'd rather surface a likely-good cafe
    // that hasn't been editorialized yet than hide it).
    if (
      r.workability_score !== null &&
      r.workability_score !== undefined &&
      Number(r.workability_score) < minWorkability
    ) {
      continue
    }

    results.push({
      ...r,
      lat: Number(r.lat),
      lng: Number(r.lng),
      distance_meters: Math.round(distance),
      // Pedestrian average ~80m/min in a city. Round to nearest minute.
      walk_minutes: Math.max(1, Math.round(distance / 80)),
    })
  }

  // Sort: prefer high workability first, then distance. We don't want a
  // mediocre spot 30m away to outrank a great one 200m away.
  results.sort((a, b) => {
    const aScore = a.workability_score ?? 5 // unscored treated as middling
    const bScore = b.workability_score ?? 5
    if (Math.abs(aScore - bScore) >= 1) return bScore - aScore
    return a.distance_meters - b.distance_meters
  })

  return NextResponse.json({
    origin: { lat: body.lat, lng: body.lng },
    radius_meters: radiusMeters,
    count: Math.min(results.length, limit),
    spots: results.slice(0, limit),
  })
}

/** Haversine distance in meters. */
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000 // earth radius, meters
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}
