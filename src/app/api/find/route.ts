/**
 * /api/find — public mode-based recommendation endpoint.
 *
 * Body:
 *   { mode: ModeId, modifiers?: ModifierId[], lat?: number, lng?: number, limit?: number }
 *
 * Returns ranked spots with fit_score, fit_reason, and optional distance.
 * Pure deterministic — no LLM, no Google Places fetch — so it returns in
 * <500ms regardless of upstream availability.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { rankSpots } from '@/lib/find/rank'
import type { Spot } from '@/types'

interface Body {
  mode: string
  modifiers?: string[]
  lat?: number
  lng?: number
  limit?: number
}

const VALID_MODES = new Set([
  'deep_work',
  'study_session',
  'creative_reset',
  'coffee_date',
  'client_meeting',
  'other',
])
const VALID_MODIFIERS = new Set(['open_late', 'quiet_to_read'])

export async function POST(req: NextRequest) {
  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.mode || !VALID_MODES.has(body.mode)) {
    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 })
  }
  const modifiers = (body.modifiers ?? []).filter((m) => VALID_MODIFIERS.has(m))
  const limit = Math.min(Math.max(body.limit ?? 8, 1), 25)

  const { data, error } = await supabase
    .from('spots')
    .select('*')
    .eq('status', 'approved')

  if (error) {
    console.error('[find] DB error:', error.message)
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }

  const origin =
    typeof body.lat === 'number' && typeof body.lng === 'number'
      ? { lat: body.lat, lng: body.lng }
      : undefined

  const ranked = rankSpots((data ?? []) as Spot[], {
    mode: body.mode as Parameters<typeof rankSpots>[1]['mode'],
    modifiers: modifiers as Parameters<typeof rankSpots>[1]['modifiers'],
    origin,
    limit,
  })

  return NextResponse.json({
    mode: body.mode,
    modifiers,
    count: ranked.length,
    spots: ranked,
  })
}
