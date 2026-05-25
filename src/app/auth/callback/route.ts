/**
 * /auth/callback — handles the magic-link redirect from Supabase Auth.
 *
 * The email link points here with ?code=<one-time-code>. We exchange
 * that code for a session, set the auth cookie, then redirect to the
 * destination (default /).
 *
 * If the exchange fails (expired, reused, mismatched), redirect back to
 * /login with an error param so the UI can re-prompt.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[auth/callback] exchange failed:', error.message)
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`)
  }

  return NextResponse.redirect(`${origin}${next}`)
}
