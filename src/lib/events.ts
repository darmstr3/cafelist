/**
 * Client-side helper for firing user_events. Fire-and-forget — never
 * awaits, never throws. Analytics must not block UX.
 *
 * Usage:
 *   logEvent('near_me_search', { payload: { radiusMeters: 800 } })
 *   logEvent('spot_click', { spot_id: '...', path: '/' })
 *   logEventOnce('cafe_view:' + spotId, 'cafe_view', { spot_id: spotId })
 *
 * Privacy: never put names, emails, free-text comments, or precise
 * coordinates in payloads. Search queries are lowercased + truncated.
 */

export type EventType =
  | 'page_view'
  | 'spot_click'
  | 'near_me_search'
  | 'near_me_result_click'
  | 'sign_in'
  | 'sign_out'
  | 'submit_attempt'
  // Taxonomy v2 (2026-10-31) — requires migration 20261031_user_events_taxonomy.sql
  | 'cafe_search'
  | 'filter_apply'
  | 'cafe_view'
  | 'directions_click'
  | 'review_submit'

interface LogEventArgs {
  path?: string
  spot_id?: string
  payload?: Record<string, unknown>
}

const SESSION_KEY = 'cafelist_session_id'
const ONCE_KEY = 'cafelist_events_once'

function getOrCreateSessionId(): string | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    let id = localStorage.getItem(SESSION_KEY)
    if (!id) {
      id = `s_${crypto.randomUUID()}`
      localStorage.setItem(SESSION_KEY, id)
    }
    return id
  } catch {
    return undefined
  }
}

function isLikelyBot(): boolean {
  if (typeof navigator === 'undefined') return true
  // navigator.webdriver is true for headless/automated browsers.
  if (navigator.webdriver) return true
  return /bot|crawl|spider|slurp|headless|lighthouse/i.test(navigator.userAgent)
}

function deviceClass(): 'mobile' | 'desktop' {
  if (typeof window === 'undefined') return 'desktop'
  return window.matchMedia?.('(max-width: 767px)').matches ? 'mobile' : 'desktop'
}

export function logEvent(event_type: EventType, args: LogEventArgs = {}) {
  if (typeof window === 'undefined') return
  if (isLikelyBot()) return
  const body = {
    event_type,
    session_id: getOrCreateSessionId(),
    path: args.path ?? window.location.pathname,
    spot_id: args.spot_id,
    payload: {
      device: deviceClass(),
      // Referrer host only (not full URL) — enough for source attribution.
      ref: document.referrer ? safeHost(document.referrer) : null,
      ...args.payload,
    },
  }
  fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true, // survive page transitions (directions clicks navigate away)
  }).catch(() => {
    /* swallow — analytics must not break the page */
  })
}

/**
 * Fire an event at most once per browser tab session for a given key.
 * Prevents duplicate cafe_view on re-render, back/forward, or React
 * Strict Mode double-mount.
 */
export function logEventOnce(key: string, event_type: EventType, args: LogEventArgs = {}) {
  if (typeof window === 'undefined') return
  try {
    const seen = new Set<string>(JSON.parse(sessionStorage.getItem(ONCE_KEY) ?? '[]'))
    if (seen.has(key)) return
    seen.add(key)
    sessionStorage.setItem(ONCE_KEY, JSON.stringify([...seen].slice(-200)))
  } catch {
    // sessionStorage unavailable — fall back to in-memory guard
    const mem = ((window as unknown as { __clOnce?: Set<string> }).__clOnce ??= new Set())
    if (mem.has(key)) return
    mem.add(key)
  }
  logEvent(event_type, args)
}

function safeHost(url: string): string | null {
  try {
    const h = new URL(url).hostname
    return h === window.location.hostname ? 'internal' : h
  } catch {
    return null
  }
}

export function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80)
}
