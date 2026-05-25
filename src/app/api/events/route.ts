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

interface EventBody {
  event_type:
    | 'page_view'
    | 'spot_click'
    | 'near_me_search'
    | 'near_me_result_click'
    | 'sign_in'
    | 'sign_out'
    | 'submit_attempt'
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
])

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

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { error } = await supabase.from('user_events').insert({
    user_id: user?.id ?? null,
    session_id: body.session_id ?? null,
    event_type: body.event_type,
    path: body.path?.slice(0, 500) ?? null,
    spot_id: body.spot_id ?? null,
    payload: body.payload ?? {},
    user_agent: req.headers.get('user-agent')?.slice(0, 500) ?? null,
  })

  if (error) {
    // Log but don't fail the user-facing action — analytics shouldn't break UX.
    console.error('[events] insert failed:', error.message)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
