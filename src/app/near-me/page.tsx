/**
 * /near-me — geolocation-driven discovery
 *
 * Real-world scenario this serves: "I just left a cafe with a friend, we're
 * waiting on a third person, I want a change of scene but don't know exactly
 * where I am or what neighborhood I'm bordering."
 *
 * Privacy posture (matches /api/near-me):
 *   - Geolocation prompt is browser-gated, HTTPS-only
 *   - The lat/lng is sent ONCE per "find" action to /api/near-me
 *   - Nothing is persisted in localStorage, cookies, or analytics
 *   - The user can re-prompt or change radius without re-requesting permission
 */

'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { logEvent } from '@/lib/events'

interface NearMeSpot {
  id: string
  slug: string
  name: string
  type: string
  city: string
  neighborhood: string | null
  workability_score: number | null
  workability_reasoning: string | null
  has_outlets: boolean
  has_wifi: boolean
  laptop_friendly: boolean
  vibe_tags: string[]
  distance_meters: number
  walk_minutes: number
}

type Status =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'searching'; lat: number; lng: number }
  | { kind: 'ready'; spots: NearMeSpot[]; origin: { lat: number; lng: number } }
  | { kind: 'error'; message: string }

const RADIUS_OPTIONS = [
  { label: '5 min walk', meters: 400 },
  { label: '10 min walk', meters: 800 },
  { label: '20 min walk', meters: 1600 },
  { label: '30 min walk', meters: 2400 },
]

export default function NearMePage() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [radius, setRadius] = useState(800)

  // If the home-page NearMeBanner already collected coordinates, they're in
  // the URL hash like #lat=40.7&lng=-73.9. Hash is used (not query string)
  // so the coordinates never reach the server in any request log.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const hash = window.location.hash.replace(/^#/, '')
    if (!hash) return
    const params = new URLSearchParams(hash)
    const lat = parseFloat(params.get('lat') ?? '')
    const lng = parseFloat(params.get('lng') ?? '')
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    setStatus({ kind: 'searching', lat, lng })
    fetchNearby(lat, lng, radius)
    // Clear the hash so a refresh doesn't keep re-triggering on stale coords.
    history.replaceState(null, '', window.location.pathname)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function findNearMe() {
    if (!('geolocation' in navigator)) {
      setStatus({ kind: 'error', message: 'Your browser does not support location.' })
      return
    }

    setStatus({ kind: 'locating' })

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords
        setStatus({ kind: 'searching', lat, lng })
        await fetchNearby(lat, lng, radius)
      },
      (err) => {
        let message = 'Could not get your location.'
        if (err.code === err.PERMISSION_DENIED) {
          message =
            'Location permission denied. Allow location for this site in your browser settings and try again.'
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          message = 'Your location is not available right now. Try again in a moment.'
        } else if (err.code === err.TIMEOUT) {
          message = 'Locating timed out. Try again.'
        }
        setStatus({ kind: 'error', message })
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    )
  }

  async function fetchNearby(lat: number, lng: number, radiusMeters: number) {
    logEvent('near_me_search', {
      path: '/near-me',
      payload: { radiusMeters },
    })
    try {
      const res = await fetch('/api/near-me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng, radiusMeters }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Request failed (${res.status})`)
      }
      const data = await res.json()
      setStatus({ kind: 'ready', spots: data.spots, origin: data.origin })
    } catch (e) {
      setStatus({ kind: 'error', message: (e as Error).message })
    }
  }

  async function changeRadius(newRadius: number) {
    setRadius(newRadius)
    if (status.kind === 'ready') {
      setStatus({ kind: 'searching', lat: status.origin.lat, lng: status.origin.lng })
      await fetchNearby(status.origin.lat, status.origin.lng, newRadius)
    }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
      <div
        className="sticky top-0 z-20 border-b"
        style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <Link href="/" className="flex items-baseline gap-2 shrink-0">
            <span className="wordmark text-[18px]" style={{ color: 'var(--text-primary)' }}>
              Cafelist
            </span>
            <span className="text-[11px] hidden sm:inline" style={{ color: 'var(--text-muted)' }}>
              Near you.
            </span>
          </Link>
          <Link
            href="/"
            className="ml-auto text-[11px] font-medium transition-opacity hover:opacity-80"
            style={{ color: 'var(--text-muted)' }}
          >
            ← Back to all
          </Link>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        {status.kind === 'idle' && (
          <div className="flex flex-col items-center gap-5 py-16 text-center">
            <span className="text-5xl">📍</span>
            <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              Find a cafe near you
            </h1>
            <p
              className="text-sm leading-relaxed max-w-md"
              style={{ color: 'var(--text-secondary)' }}
            >
              We&apos;ll use your location once to show workable cafes within walking distance,
              ranked by how good a place they are to actually sit down and work. We don&apos;t store
              your location.
            </p>
            <button
              onClick={findNearMe}
              className="mt-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--accent)', color: 'white' }}
            >
              Use my location
            </button>
          </div>
        )}

        {status.kind === 'locating' && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <span className="text-3xl">📍</span>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Getting your location…
            </p>
          </div>
        )}

        {status.kind === 'searching' && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Finding cafes near you…
            </p>
          </div>
        )}

        {status.kind === 'error' && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p
              className="text-sm leading-relaxed max-w-md"
              style={{ color: 'var(--text-secondary)' }}
            >
              {status.message}
            </p>
            <button
              onClick={findNearMe}
              className="mt-2 px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--accent)', color: 'white' }}
            >
              Try again
            </button>
          </div>
        )}

        {status.kind === 'ready' && (
          <>
            <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
              <div>
                <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Within {RADIUS_OPTIONS.find((o) => o.meters === radius)?.label ?? `${radius}m`}
                </p>
                <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                  {status.spots.length} cafes
                </p>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {RADIUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.meters}
                    onClick={() => changeRadius(opt.meters)}
                    className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-opacity hover:opacity-80"
                    style={{
                      backgroundColor:
                        radius === opt.meters ? 'var(--accent)' : 'var(--surface)',
                      color: radius === opt.meters ? 'white' : 'var(--text-secondary)',
                      border: radius === opt.meters ? 'none' : '1px solid var(--border-subtle)',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {status.spots.length === 0 && (
              <div className="text-center py-12">
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  No cafes in this radius. Try widening the walk.
                </p>
              </div>
            )}

            <div className="flex flex-col gap-3">
              {status.spots.map((spot) => (
                <Link
                  key={spot.id}
                  href={`/spot/${spot.slug}`}
                  onClick={() =>
                    logEvent('near_me_result_click', {
                      spot_id: spot.id,
                      path: '/near-me',
                      payload: {
                        distance_meters: spot.distance_meters,
                        workability_score: spot.workability_score,
                      },
                    })
                  }
                  className="block p-4 rounded-lg border transition-opacity hover:opacity-90"
                  style={{
                    backgroundColor: 'var(--surface)',
                    borderColor: 'var(--border-subtle)',
                  }}
                >
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <h3
                      className="text-[15px] font-semibold leading-tight"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {spot.name}
                    </h3>
                    <div className="shrink-0 flex flex-col items-end gap-0.5">
                      <span
                        className="text-[11px] font-medium"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {spot.walk_minutes} min
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        {spot.distance_meters}m
                      </span>
                    </div>
                  </div>
                  <p className="text-[12px] mb-2" style={{ color: 'var(--text-muted)' }}>
                    {spot.neighborhood ? `${spot.neighborhood} · ` : ''}
                    {spot.type.replace('_', ' ')}
                    {spot.workability_score != null && (
                      <>
                        {' · '}
                        <span style={{ color: scoreColor(spot.workability_score) }}>
                          {Number(spot.workability_score).toFixed(1)}/10 workable
                        </span>
                      </>
                    )}
                  </p>
                  {spot.workability_reasoning && (
                    <p
                      className="text-[12px] leading-snug italic"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      “{spot.workability_reasoning}”
                    </p>
                  )}
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function scoreColor(score: number): string {
  if (score >= 8) return '#0e6b2c'
  if (score >= 6) return '#1a8a3a'
  if (score >= 4) return '#8a5a00'
  return '#9a1a1a'
}
