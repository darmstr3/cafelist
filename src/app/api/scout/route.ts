import { NextRequest, NextResponse } from 'next/server'
import { runScout, DAILY_CAP_USD, PER_RUN_CAP_USD } from '@/lib/scout'
import { supabaseAdmin } from '@/lib/supabase'

// Scout fetches up to 3 text searches + 25 detail calls with sleeps;
// expect ~6–10 seconds of API I/O. Bump Vercel's per-route limit
// well above the default so we don't timeout mid-run.
export const maxDuration = 60
export const dynamic = 'force-dynamic'

/**
 * GET /api/scout
 *
 * Triggers one Scout run. Designed to be called every 4 hours by
 * Vercel Cron (see vercel.json) — and manually by operators / the
 * /admin/ops dashboard "Run scout now" button.
 *
 * Auth: accepts a Bearer matching either env var below, OR a
 * `?token=<value>` query string matching `SCOUT_CRON_SECRET`:
 *   - `CRON_SECRET`        — auto-injected by Vercel Cron as
 *                            `Authorization: Bearer ${CRON_SECRET}`.
 *   - `SCOUT_CRON_SECRET`  — operator secret for manual / dashboard
 *                            triggers; safe to share with the
 *                            ops dashboard's server-side trigger
 *                            route.
 *
 * If neither env var is set, the route is open (local dev only).
 * We fail closed on production by requiring at least one secret
 * when running on Vercel.
 *
 * Query params:
 *   - city=<name>    forced city override (skips priority queue)
 *   - dry=1          dry-run (don't insert, don't write scout_runs)
 */
export async function GET(req: NextRequest) {
  const scoutSecret = process.env.SCOUT_CRON_SECRET
  const cronSecret = process.env.CRON_SECRET
  const isProd = process.env.VERCEL_ENV === 'production'

  if (!scoutSecret && !cronSecret && isProd) {
    return NextResponse.json(
      {
        error:
          'Neither SCOUT_CRON_SECRET nor CRON_SECRET is configured on the server',
      },
      { status: 500 },
    )
  }

  if (scoutSecret || cronSecret) {
    const url = new URL(req.url)
    const header = req.headers.get('authorization') ?? ''
    const fromHeader = header.startsWith('Bearer ') ? header.slice(7) : null
    const fromQuery = url.searchParams.get('token')

    const headerMatches =
      (!!scoutSecret && fromHeader === scoutSecret) ||
      (!!cronSecret && fromHeader === cronSecret)
    // Query-param auth is intentionally limited to the operator
    // secret so a leaked Vercel CRON_SECRET in a referrer log
    // can't be replayed via URL.
    const queryMatches = !!scoutSecret && fromQuery === scoutSecret

    if (!headerMatches && !queryMatches) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  const url = new URL(req.url)
  const forcedCity = url.searchParams.get('city')
  const dryRun = url.searchParams.get('dry') === '1'

  // Buffer logs so the response can include them — useful when
  // a scheduled task is observing /api/scout output directly.
  const lines: string[] = []
  const result = await runScout(supabaseAdmin, {
    dryRun,
    forcedCity,
    logger: (m) => lines.push(m),
  })

  return NextResponse.json({
    ...result,
    caps: { per_run_usd: PER_RUN_CAP_USD, daily_usd: DAILY_CAP_USD },
    log: lines,
  })
}

/**
 * POST /api/scout
 *
 * Same as GET — just so cron systems that prefer POST (and admin
 * "Run scout now" buttons) work without contortion.
 */
export async function POST(req: NextRequest) {
  return GET(req)
}
