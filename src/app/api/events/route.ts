/**
 * /api/events — append a row to user_events. Fire-and-forget from the
 * client. Captures the current Supabase user when signed in; logs
 * anonymously with a session_id otherwise.
 *
 * The supabase server client respects the user's RLS policy, so the
 * insert is naturally scoped to their auth.uid(). For anonymous events,
 * user_id is null and the policy still allows the insert.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { EventType } from '@/lib/events'

interface EventBody {
  event_type: EventType
  path?: string
  spot_id?: string
  payload?: Record<string, unknown>
  session_id?: string
}

const VALID_TYPES = new Set([
  'page_view',
  'spot_click',
  'near_me_search',
  'near_me_result_click',
  'sign_in',
  'sign_out',
  'submit_attempt',
  'cafe_search',
  'filter_apply',
  'cafe_view',
  'directions_click',
  'review_submit',
])

const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|curl|wget|python-requests/i

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Cap payload size so a malicious client can't stuff the table.
const MAX_PAYLOAD_BYTES = 2000

export async function POST(req: NextRequest) {
  let body: EventBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.event_type || !VALID_TYPES.has(body.event_type)) {
    return NextResponse.json({ ok: false, error: 'Invalid event_type' }, { status: 400 })
  }

  const ua = req.headers.get('user-agent') ?? ''
  // Server-side bot backstop (client already skips webdriver/headless).
  if (BOT_UA.test(ua)) {
    return NextResponse.json({ ok: true, skipped: 'bot' }, { status: 202 })
  }
  // Tag every row with the deployment environment so preview/dev traffic
  // is always separable from production in queries. Server-set — not
  // client-controllable.
  const payload = { ...(body.payload ?? {}), env: process.env.VERCEL_ENV ?? 'development' }
  if (JSON.stringify(payload).length > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ ok: false, error: 'Payload too large' }, { status: 413 })
  }
  const spotId = body.spot_id && UUID_RE.test(body.spot_id) ? body.spot_id : null

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const row = {
    user_id: user?.id ?? null,
    session_id: body.session_id?.slice(0, 100) ?? null,
    event_type: body.event_type,
    path: body.path?.slice(0, 500) ?? null,
    spot_id: spotId,
    payload,
    user_agent: ua.slice(0, 500) || null,
  }
  let { error } = await supabase.from('user_events').insert(row)

  // A stale/deleted spot id (FK violation) must not drop the event —
  // keep the event, null the reference, and record the id in the payload.
  if (error?.code === '23503' && spotId) {
    ;({ error } = await supabase
      .from('user_events')
      .insert({ ...row, spot_id: null, payload: { ...payload, unknown_spot_id: spotId } }))
  }

  if (error) {
    // Log but don't fail the user-facing action — analytics shouldn't break UX.
    console.error('[events] insert failed:', error.message)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
