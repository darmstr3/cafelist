// ─────────────────────────────────────────────────────────────
// Admin gate: HTTP Basic Auth in front of /admin/* and any
// mutating admin API routes.
//
// Why Basic Auth: cafelist has a single operator (Donovan), no
// account system, and the goal here is "stop random visitors from
// browsing /admin and pressing the approve button" — not enterprise
// SSO. Basic Auth gets that done in 50 lines without taking on a
// session store. Upgrade to Clerk/Supabase Auth when there's a
// second operator.
//
// Setup: set ADMIN_PASSWORD (and optionally ADMIN_USERNAME) on
// Vercel. Locally, set it in .env.local — the gate silently
// no-ops when the password is unset, so dev stays frictionless.
// In production we fail closed: if the env var is missing on
// Vercel, the gate blocks all traffic to the protected paths
// with a 503 so we never accidentally ship an open admin panel.
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'

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

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (!isProtected(pathname, req.method)) return NextResponse.next()

  const expected = process.env.ADMIN_PASSWORD
  const username = process.env.ADMIN_USERNAME ?? 'admin'
  const isProd = process.env.VERCEL_ENV === 'production'

  if (!expected) {
    // Fail closed in prod, open in dev. This stops us from ever
    // shipping an open admin panel because we forgot to set the var.
    if (isProd) {
      return new NextResponse(
        'admin gate misconfigured: ADMIN_PASSWORD env var is not set',
        { status: 503 },
      )
    }
    return NextResponse.next()
  }

  const header = req.headers.get('authorization') ?? ''
  if (!header.toLowerCase().startsWith('basic ')) return unauthorized()

  // atob is available in the edge runtime where middleware runs.
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

  // Constant-time-ish compare via length-padded equality. Basic Auth
  // is already over TLS, so this is mainly defense-in-depth.
  if (user !== username || pass.length !== expected.length) return unauthorized()
  let mismatch = 0
  for (let i = 0; i < expected.length; i++) {
    mismatch |= pass.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  if (mismatch !== 0) return unauthorized()

  return NextResponse.next()
}

// Run middleware on the same paths we gate plus a small wildcard
// for /api/spots and /api/reviews so the per-id write paths hit it.
// Matchers must be static strings; the per-method filtering happens
// inside isProtected().
export const config = {
  matcher: [
    '/admin',
    '/admin/:path*',
    '/api/import',
    '/api/spots/:path*',
    '/api/reviews/:path*',
    '/labs',
    '/labs/:path*',
    '/api/labs/:path*',
  ],
}
