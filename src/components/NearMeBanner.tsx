'use client'

/**
 * NearMeBanner — prominent hero CTA on the home page that triggers
 * browser geolocation in one click and navigates to /near-me with the
 * result baked in as URL params. The /near-me page reads those params
 * and skips its own "Use my location" prompt.
 *
 * Privacy posture matches /near-me:
 *   - Browser geolocation prompt is the single consent gate
 *   - lat/lng is passed via URL fragment (NOT query string) so it
 *     never reaches the server logs even by accident; the /near-me
 *     client reads it from window.location.hash
 *   - Nothing persists in cookies/localStorage
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { logEvent } from '@/lib/events'

export function NearMeBanner() {
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'locating' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  function findNearMe() {
    if (!('geolocation' in navigator)) {
      setStatus('error')
      setErrorMsg('Your browser does not support location.')
      return
    }
    setStatus('locating')
    logEvent('near_me_search', { path: '/', payload: { source: 'home_banner' } })
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        // Use hash, not query — keeps lat/lng out of server-side request
        // logs and any analytics that capture full URLs.
        router.push(`/near-me#lat=${latitude.toFixed(5)}&lng=${longitude.toFixed(5)}`)
      },
      (err) => {
        setStatus('error')
        if (err.code === err.PERMISSION_DENIED) {
          setErrorMsg('Location denied. Allow it in your browser settings to use this.')
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setErrorMsg('Your location isn’t available right now. Try again in a moment.')
        } else if (err.code === err.TIMEOUT) {
          setErrorMsg('Locating timed out. Try again.')
        } else {
          setErrorMsg('Could not get your location.')
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    )
  }

  return (
    <div
      className="border-b"
      style={{
        background:
          'linear-gradient(180deg, rgba(217,119,87,0.08) 0%, rgba(217,119,87,0.02) 100%)',
        borderColor: 'var(--border-subtle)',
      }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 sm:py-7 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5">
        <div className="flex-1">
          <h2
            className="text-[18px] sm:text-[20px] font-semibold leading-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            Find a workable cafe near you
          </h2>
          <p
            className="text-[13px] mt-1 leading-snug"
            style={{ color: 'var(--text-secondary)' }}
          >
            One tap. We&apos;ll show good spots within walking distance, ranked by how
            workable they actually are. Your location isn&apos;t stored.
          </p>
        </div>
        <div className="flex flex-col items-stretch sm:items-end gap-1.5 shrink-0">
          <button
            onClick={findNearMe}
            disabled={status === 'locating'}
            className="px-5 py-3 rounded-lg text-[14px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-wait whitespace-nowrap"
            style={{ backgroundColor: 'var(--accent)', color: 'white' }}
          >
            {status === 'locating' ? '📍 Locating…' : '📍 Use my location'}
          </button>
          {status === 'error' && (
            <p
              className="text-[11px] leading-snug max-w-[260px] text-right"
              style={{ color: 'var(--no)' }}
            >
              {errorMsg}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
