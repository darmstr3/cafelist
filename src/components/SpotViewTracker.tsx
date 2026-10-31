'use client'

/**
 * Invisible tracker for /spot/[slug] pages.
 *  - cafe_view: once per tab session per spot (logEventOnce).
 *  - directions_click: delegated listener on any element marked
 *    data-track="directions" data-provider="apple|google" data-placement="...".
 *    Deduped per spot+provider for 5s to absorb double-taps.
 * Keeps the spot page a server component — no props drilled into anchors.
 */

import { useEffect } from 'react'
import { logEvent, logEventOnce } from '@/lib/events'

interface Props {
  spotId: string
  slug: string
  neighborhood: string | null
  workabilityScore: number | null
  openNow: boolean
}

export function SpotViewTracker({ spotId, slug, neighborhood, workabilityScore, openNow }: Props) {
  useEffect(() => {
    logEventOnce(`cafe_view:${spotId}`, 'cafe_view', {
      spot_id: spotId,
      payload: { slug, neighborhood, workability_score: workabilityScore, open_now: openNow },
    })

    const recent = new Map<string, number>()
    function onClick(e: MouseEvent) {
      const el = (e.target as HTMLElement).closest('[data-track="directions"]') as HTMLElement | null
      if (!el) return
      const provider = el.dataset.provider ?? 'unknown'
      const now = Date.now()
      if (now - (recent.get(provider) ?? 0) < 5000) return
      recent.set(provider, now)
      logEvent('directions_click', {
        spot_id: spotId,
        payload: { slug, provider, placement: el.dataset.placement ?? null, neighborhood },
      })
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [spotId, slug, neighborhood, workabilityScore, openNow])

  return null
}
