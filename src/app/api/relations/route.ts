/**
 * /api/relations — toggle a user_spot_relations row (favorite/tried/want_to_go).
 *
 * POST { spot_id, relation_type } → adds the relation
 * DELETE { spot_id, relation_type } → removes it
 *
 * Always scoped to the current Supabase user (auth.uid()), enforced by RLS.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const VALID_TYPES = new Set(['favorite', 'tried', 'want_to_go'])

interface Body {
  spot_id: string
  relation_type: 'favorite' | 'tried' | 'want_to_go'
}

async function requireUser() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return { supabase, user }
}

export async function POST(req: NextRequest) {
  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.spot_id || !VALID_TYPES.has(body.relation_type)) {
    return NextResponse.json({ ok: false, error: 'Invalid params' }, { status: 400 })
  }

  const { supabase, user } = await requireUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in required' }, { status: 401 })

  const { error } = await supabase.from('user_spot_relations').upsert(
    {
      user_id: user.id,
      spot_id: body.spot_id,
      relation_type: body.relation_type,
      visited_at: body.relation_type === 'tried' ? new Date().toISOString() : null,
    },
    { onConflict: 'user_id,spot_id,relation_type' }
  )
  if (error) {
    console.error('[relations] insert failed:', error.message)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.spot_id || !VALID_TYPES.has(body.relation_type)) {
    return NextResponse.json({ ok: false, error: 'Invalid params' }, { status: 400 })
  }

  const { supabase, user } = await requireUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in required' }, { status: 401 })

  const { error } = await supabase
    .from('user_spot_relations')
    .delete()
    .eq('user_id', user.id)
    .eq('spot_id', body.spot_id)
    .eq('relation_type', body.relation_type)
  if (error) {
    console.error('[relations] delete failed:', error.message)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
