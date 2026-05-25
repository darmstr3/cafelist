/**
 * Client-side helper for firing user_events. Fire-and-forget — never
 * awaits, never throws. Analytics must not block UX.
 *
 * Usage:
 *   logEvent('near_me_search', { payload: { radiusMeters: 800 } })
 *   logEvent('spot_click', { spot_id: '...', path: '/' })
 */

interface LogEventArgs {
  path?: string
  spot_id?: string
  payload?: Record<string, unknown>
}

const SESSION_KEY = 'cafelist_session_id'

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

export function logEvent(
  event_type:
    | 'page_view'
    | 'spot_click'
    | 'near_me_search'
    | 'near_me_result_click'
    | 'sign_in'
    | 'sign_out'
    | 'submit_attempt',
  args: LogEventArgs = {}
) {
  if (typeof window === 'undefined') return
  const body = {
    event_type,
    session_id: getOrCreateSessionId(),
    ...args,
  }
  // Fire-and-forget. No await, no error surfacing.
  fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true, // survive page transitions
  }).catch(() => {
    /* swallow — analytics must not break the page */
  })
}
