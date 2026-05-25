// ─────────────────────────────────────────────────────────────
// Middleware does two unrelated things:
//
// 1. Supabase auth session refresh (all paths). Without this,
//    auth cookies expire silently and signed-in users get logged
//    out after the access token's short TTL.
//
// 2. Admin gate via HTTP Basic Auth on /admin/* and the mutating
//    admin API routes. This is separate from Supabase user auth —
//    Donovan logs into admin with a shared username/password set
//    via ADMIN_PASSWORD env var; site visitors authenticate with
//    Supabase magic links (different surface, different concern).
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const PROTECTED_PREFIXES = [
  '/admin',
  // Mutating spot/review endpoints — anyone hitting these directly
  // can flip pending → approved or wipe rows. The bulk-import route
  // is similarly destructive.
  '/api/import',
  // /labs is the in-progress agentic discovery surface. Not ready for
  // public eyes (incomplete, may surface dev internals, paid LLM calls
  // per query). Keep it admin-only until we're shipping it.
  '/labs',
  '/api/labs',
]

// Methods we let through unauthenticated even on protected paths.
// (Currently empty — admin needs auth even for GET so the page
//  never renders for an anonymous viewer.)
const PUBLIC_METHODS_ON_PROTECTED_PATHS = new Set<string>([])

// /api/spots/[id] and /api/reviews/[id] are listed separately
// because the GET paths are used by the public spot detail pages
// (read-only). We only gate write methods on those.
const READ_ONLY_GATED_PATHS = ['/api/spots/', '/api/reviews/']
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function isProtected(pathname: string, method: string): boolean {
  if (PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    if (PUBLIC_METHODS_ON_PROTECTED_PATHS.has(method)) return false
    return true
  }
  if (
    READ_ONLY_GATED_PATHS.some((p) => pathname.startsWith(p)) &&
    WRITE_METHODS.has(method)
  ) {
    return true
  }
  return false
}

function unauthorized(): NextResponse {
  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      // realm string only shows up in the browser prompt; using
      // "cafelist-admin" so the user knows what they're signing into.
      'WWW-Authenticate': 'Basic realm="cafelist-admin", charset="UTF-8"',
    },
  })
}

/** Refresh the Supabase auth cookies, attached to the response. */
async function refreshSupabaseSession(req: NextRequest, res: NextResponse) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) return res

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll()
      },
      setAll(toSet) {
        toSet.forEach(({ name, value, options }) => {
          res.cookies.set(name, value, options)
        })
      },
    },
  })
  // Touching getUser() triggers a session refresh if needed.
  await supabase.auth.getUser()
  return res
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // (1) Admin gate first — admin paths must be locked before anything else
  //     touches them.
  if (isProtected(pathname, req.method)) {
    const expected = process.env.ADMIN_PASSWORD
    const username = process.env.ADMIN_USERNAME ?? 'admin'
    const isProd = process.env.VERCEL_ENV === 'production'

    if (!expected) {
      if (isProd) {
        return new NextResponse(
          'admin gate misconfigured: ADMIN_PASSWORD env var is not set',
          { status: 503 },
        )
      }
      // dev: fall through to Supabase refresh
    } else {
      const header = req.headers.get('authorization') ?? ''
      if (!header.toLowerCase().startsWith('basic ')) return unauthorized()

      let decoded = ''
      try {
        decoded = atob(header.slice(6).trim())
      } catch {
        return unauthorized()
      }

      const sepIdx = decoded.indexOf(':')
      if (sepIdx < 0) return unauthorized()
      const user = decoded.slice(0, sepIdx)
      const pass = decoded.slice(sepIdx + 1)

      if (user !== username || pass.length !== expected.length) return unauthorized()
      let mismatch = 0
      for (let i = 0; i < expected.length; i++) {
        mismatch |= pass.charCodeAt(i) ^ expected.charCodeAt(i)
      }
      if (mismatch !== 0) return unauthorized()
    }
  }

  // (2) Refresh Supabase auth cookies on every request that reaches here.
  //     This keeps signed-in users signed in across requests.
  return refreshSupabaseSession(req, NextResponse.next())
}

// Match all paths except Next.js static assets, the public dir, and image
// optimizer outputs. This runs middleware on /, /near-me, /spot/[id], /login,
// /auth/callback, etc. — everything that needs auth-cookie refresh.
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (e.g. svgs in /public)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
