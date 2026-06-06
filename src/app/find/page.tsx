/**
 * /find — public mode-based discovery.
 *
 * Flow:
 *   1. User picks a mode (Deep Work, Creative Reset, Coffee Date, Client Meeting)
 *   2. Results render instantly (no LLM in the path)
 *   3. Modifier pills toggle additional constraints; results re-rank in place
 *   4. Optional: "Use my location" biases results toward closer spots
 *
 * Reliability: this surface intentionally bypasses /labs's LLM pipeline.
 * The ranker is pure SQL fetch + in-memory filter + score. No upstream
 * model dependencies means it returns in <500ms every time.
 */

'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { MODES, MODIFIERS, type ModeId, type ModifierId } from '@/lib/labs/modes'
import { logEvent } from '@/lib/events'
import {
  isOpenNow,
  is24Hours,
  closingTimeToday,
  formatTime,
} from '@/lib/utils'
import type { SpotHours } from '@/types'

/** Plain-English hours label for a result card. Returns null when there's
 * no hours data so we can omit the line rather than show "unknown". */
function hoursLabel(hours: SpotHours | null): { text: string; tone: 'open' | 'closed' | 'unknown' } | null {
  if (!hours) return null
  if (is24Hours(hours)) return { text: 'Open 24 hours', tone: 'open' }
  const open = isOpenNow(hours)
  const closeStr = closingTimeToday(hours)
  if (!closeStr) {
    return open ? { text: 'Open today', tone: 'open' } : { text: 'Closed today', tone: 'closed' }
  }
  if (open) return { text: `Open until ${formatTime(closeStr)}`, tone: 'open' }
  return { text: 'Closed', tone: 'closed' }
}

interface RankedSpot {
  spot: {
    id: string
    slug: string
    name: string
    type: string
    neighborhood: string | null
    city: string
    photos?: Array<{ url: string; caption?: string }>
    workability_score: number | null
    workability_reasoning: string | null
    vibe_tags: string[]
    hours: SpotHours | null
  }
  fit_score: number
  fit_reason: string
  distance_meters?: number
}

// Note: keeping the 4 canonical modes from LABS_V2_PLAN MVP. `study_session`
// is in the registry on feat/labs-v2-recommend-route but not on main yet;
// adding it here would break the type check until that branch lands.
const MODE_ORDER: ModeId[] = [
  'deep_work',
  'creative_reset',
  'coffee_date',
  'client_meeting',
]

const MODIFIER_ORDER: ModifierId[] = ['open_late', 'quiet_to_read']

type Status =
  | { kind: 'picking' }
  | { kind: 'loading' }
  | { kind: 'ready'; spots: RankedSpot[] }
  | { kind: 'error'; message: string }

export default function FindPage() {
  const [mode, setMode] = useState<ModeId | null>(null)
  const [modifiers, setModifiers] = useState<Set<ModifierId>>(new Set())
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'picking' })

  const modifiersArr = useMemo(() => Array.from(modifiers), [modifiers])

  // Fetch results whenever mode or modifiers change (after first pick).
  useEffect(() => {
    if (!mode) return
    let cancelled = false
    setStatus({ kind: 'loading' })

    logEvent('near_me_search', {
      path: '/find',
      payload: { mode, modifiers: modifiersArr, has_origin: !!origin },
    })

    ;(async () => {
      try {
        const res = await fetch('/api/find', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode,
            modifiers: modifiersArr,
            lat: origin?.lat,
            lng: origin?.lng,
          }),
        })
        if (!res.ok) throw new Error(`Request failed (${res.status})`)
        const data = await res.json()
        if (!cancelled) setStatus({ kind: 'ready', spots: data.spots ?? [] })
      } catch (e) {
        if (!cancelled) setStatus({ kind: 'error', message: (e as Error).message })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mode, modifiersArr, origin])

  function toggleModifier(id: ModifierId) {
    const next = new Set(modifiers)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setModifiers(next)
  }

  function useMyLocation() {
    if (!('geolocation' in navigator)) return
    navigator.geolocation.getCurrentPosition(
      (pos) => setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
      {/* Top bar */}
      <div
        className="sticky top-0 z-20 border-b"
        style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <Link href="/" className="flex items-baseline gap-2 shrink-0">
            <span className="wordmark text-[18px]" style={{ color: 'var(--text-primary)' }}>
              Cafelist
            </span>
            <span className="text-[11px] hidden sm:inline" style={{ color: 'var(--text-muted)' }}>
              Find your fit.
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

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1
            className="text-[22px] sm:text-[26px] font-bold leading-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            What kind of coffee outing is this?
          </h1>
          <p className="text-[13px] mt-1" style={{ color: 'var(--text-secondary)' }}>
            Pick a mode, get tailored picks. Add modifiers to refine.
          </p>
        </div>

        {/* Mode picker — always visible, current selection highlighted */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-5">
          {MODE_ORDER.map((id) => {
            const m = MODES[id]
            const active = mode === id
            return (
              <button
                key={id}
                onClick={() => setMode(id)}
                className="text-left p-3 rounded-lg border transition-all hover:opacity-90"
                style={{
                  backgroundColor: active ? 'var(--accent)' : 'var(--surface)',
                  borderColor: active ? 'var(--accent)' : 'var(--border-subtle)',
                  color: active ? 'white' : 'var(--text-primary)',
                }}
              >
                <div className="text-[14px] font-semibold leading-tight">{m.label}</div>
                <div
                  className="text-[11px] mt-1 leading-snug"
                  style={{ color: active ? 'rgba(255,255,255,0.85)' : 'var(--text-muted)' }}
                >
                  {m.blurb}
                </div>
              </button>
            )
          })}
        </div>

        {/* Modifiers + location — only after a mode is picked */}
        {mode && (
          <div className="flex items-center gap-2 flex-wrap mb-6">
            <span
              className="text-[10px] uppercase tracking-wider font-medium"
              style={{ color: 'var(--text-muted)' }}
            >
              Refine:
            </span>
            {MODIFIER_ORDER.map((id) => {
              const m = MODIFIERS[id]
              const active = modifiers.has(id)
              return (
                <button
                  key={id}
                  onClick={() => toggleModifier(id)}
                  className="px-2.5 py-1 rounded-full text-[11px] font-medium border transition-opacity hover:opacity-80"
                  style={{
                    backgroundColor: active ? 'var(--accent)' : 'var(--surface)',
                    borderColor: active ? 'var(--accent)' : 'var(--border-subtle)',
                    color: active ? 'white' : 'var(--text-secondary)',
                  }}
                >
                  {m.label}
                </button>
              )
            })}
            <button
              onClick={useMyLocation}
              className="px-2.5 py-1 rounded-full text-[11px] font-medium border transition-opacity hover:opacity-80"
              style={{
                backgroundColor: origin ? 'var(--yes)' : 'var(--surface)',
                borderColor: origin ? 'var(--yes)' : 'var(--border-subtle)',
                color: origin ? 'white' : 'var(--text-secondary)',
              }}
            >
              📍 {origin ? 'Using location' : 'Near me'}
            </button>
          </div>
        )}

        {/* Results */}
        {status.kind === 'picking' && (
          <p className="text-[13px] mt-12 text-center" style={{ color: 'var(--text-muted)' }}>
            Pick a mode above to see matches.
          </p>
        )}

        {status.kind === 'loading' && (
          <p className="text-[13px] mt-6" style={{ color: 'var(--text-muted)' }}>
            Finding picks…
          </p>
        )}

        {status.kind === 'error' && (
          <p className="text-[13px] mt-6" style={{ color: 'var(--no)' }}>
            {status.message}
          </p>
        )}

        {status.kind === 'ready' && (
          <>
            <p
              className="text-[11px] uppercase tracking-wider font-medium mb-3"
              style={{ color: 'var(--text-muted)' }}
            >
              {status.spots.length} pick{status.spots.length === 1 ? '' : 's'} for{' '}
              {mode ? MODES[mode].label : ''}
            </p>
            {status.spots.length === 0 ? (
              <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                No matches with these constraints. Try removing a modifier.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {status.spots.map((r) => (
                  <Link
                    key={r.spot.id}
                    href={`/spot/${r.spot.slug}`}
                    onClick={() =>
                      logEvent('spot_click', {
                        spot_id: r.spot.id,
                        path: '/find',
                        payload: { mode, fit_score: r.fit_score },
                      })
                    }
                    className="block p-3 rounded-lg border transition-opacity hover:opacity-90"
                    style={{
                      backgroundColor: 'var(--surface)',
                      borderColor: 'var(--border-subtle)',
                    }}
                  >
                    <div className="flex items-start gap-3">
                      {r.spot.photos?.[0]?.url && (
                        <Image
                          src={r.spot.photos[0].url}
                          alt={r.spot.name}
                          width={64}
                          height={64}
                          className="rounded-md object-cover shrink-0"
                          unoptimized
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <h3
                          className="text-[14px] font-semibold leading-tight truncate"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {r.spot.name}
                        </h3>
                        <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                          {r.spot.neighborhood ?? r.spot.city}
                          {r.distance_meters != null && (
                            <> · {Math.max(1, Math.round(r.distance_meters / 80))} min walk</>
                          )}
                        </p>
                        {(() => {
                          const hl = hoursLabel(r.spot.hours)
                          if (!hl) return null
                          const color =
                            hl.tone === 'open'
                              ? 'var(--yes)'
                              : hl.tone === 'closed'
                              ? 'var(--no)'
                              : 'var(--text-muted)'
                          return (
                            <p
                              className="text-[11px] mt-1 font-medium"
                              style={{ color }}
                            >
                              {hl.text}
                            </p>
                          )
                        })()}
                        <p
                          className="text-[11px] mt-1 leading-snug"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {r.fit_reason}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
