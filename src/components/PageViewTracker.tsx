'use client'

/**
 * First-party page_view events → Supabase user_events.
 * Complements Vercel Web Analytics (1-month retention on Hobby) with an
 * owned, unlimited-retention record that joins to product events by session_id.
 *
 * - Fires on first load and on every client-side route change.
 * - landing=true only for the first page_view in a tab session, with UTM
 *   params + referrer host captured then (attribution for growth experiments).
 * - /admin and /labs excluded so Donovan's own usage doesn't skew counts.
 * - Guarded against React Strict Mode double-effects (same path within 1s).
 */

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { logEvent } from '@/lib/events'

const LANDED_KEY = 'cafelist_landed'
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const

let lastPath = ''
let lastAt = 0

export function PageViewTracker() {
  const pathname = usePathname()

  useEffect(() => {
    if (!pathname || /^\/(admin|labs)(\/|$)/.test(pathname)) return
    const now = Date.now()
    if (pathname === lastPath && now - lastAt < 1000) return
    lastPath = pathname
    lastAt = now

    let landing = false
    try {
      landing = !sessionStorage.getItem(LANDED_KEY)
      if (landing) sessionStorage.setItem(LANDED_KEY, '1')
    } catch {
      /* storage unavailable — treat as non-landing */
    }

    const payload: Record<string, unknown> = { landing }
    if (landing) {
      const params = new URLSearchParams(window.location.search)
      for (const k of UTM_KEYS) {
        const v = params.get(k)
        if (v) payload[k] = v.slice(0, 100)
      }
    }
    logEvent('page_view', { path: pathname, payload })
  }, [pathname])

  return null
}
