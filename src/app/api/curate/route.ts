import { NextRequest, NextResponse } from 'next/server'
import { runCurator, DEFAULT_COST_CAP_USD, DEFAULT_CRON_LIMIT } from '@/lib/curator'
import { supabaseAdmin } from '@/lib/supabase'

// A cron-triggered run is capped to DEFAULT_CRON_LIMIT rows (see
// src/lib/curator.ts) so one invocation can't run past the function
// time limit. At concurrency 4 with Haiku, that's comfortably inside
// this budget; bump both together if the cap ever needs raising.
export const maxDuration = 90
export const dynamic = 'force-dynamic'

/**
 * GET /api/curate
 *
 * Triggers one Curator run: scores unscored/stale approved spots with
 * workability_score. Designed to be called daily by Vercel Cron (see
 * vercel.json) — and manually by operators / an ops dashboard
 * "Run curator now" button.
 *
 * Background: this agent's logic (src/lib/curator.ts, originally
 * scripts/curate-workability.ts as a CLI-only script) was never wired
 * into any schedule — vercel.json only scheduled /api/scout. As a
 * result workability_score never refreshed past its initial backfill,
 * and data_confidence (supabase/migrations/
 * 20261031_outlet_status_and_data_confidence.sql) could never reach
 * 'verified' for any row. This route + its vercel.json cron entry are
 * the fix.
 *
 * Auth: same pattern as /api/scout — accepts a Bearer matching either
 * env var below, OR a `?token=<value>` query string matching
 * `CURATOR_CRON_SECRET`:
 *   - `CRON_SECRET`          — auto-injected by Vercel Cron as
 *                              `Authorization: Bearer ${CRON_SECRET}`.
 *                              Shared across all cron paths in the
 *                              project, same as /api/scout.
 *   - `CURATOR_CRON_SECRET`  — operator secret for manual / dashboard
 *                              triggers.
 *
 * If neither env var is set, the route is open (local dev only). We
 * fail closed on production by requiring at least one secret.
 *
 * Query params:
 *   - dry=1          dry-run (call the LLM, don't write to spots)
 *   - force=1        ignore the 90-day staleness gate, re-score everyone
 *   - limit=<n>       override DEFAULT_CRON_LIMIT for this run
 *   - costCap=<usd>   override DEFAULT_COST_CAP_USD for this run
 */
export async function GET(req: NextRequest) {
  const curatorSecret = process.env.CURATOR_CRON_SECRET
  const cronSecret = process.env.CRON_SECRET
  const isProd = process.env.VERCEL_ENV === 'production'

  if (!curatorSecret && !cronSecret && isProd) {
    return NextResponse.json(
      {
        error:
          'Neither CURATOR_CRON_SECRET nor CRON_SECRET is configured on the server',
      },
      { status: 500 },
    )
  }

  if (curatorSecret || cronSecret) {
    const url = new URL(req.url)
    const header = req.headers.get('authorization') ?? ''
    const fromHeader = header.startsWith('Bearer ') ? header.slice(7) : null
    const fromQuery = url.searchParams.get('token')

    const headerMatches =
      (!!curatorSecret && fromHeader === curatorSecret) ||
      (!!cronSecret && fromHeader === cronSecret)
    // Query-param auth is intentionally limited to the operator secret,
    // same reasoning as /api/scout: a leaked Vercel CRON_SECRET in a
    // referrer log can't be replayed via URL.
    const queryMatches = !!curatorSecret && fromQuery === curatorSecret

    if (!headerMatches && !queryMatches) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  const url = new URL(req.url)
  const dryRun = url.searchParams.get('dry') === '1'
  const force = url.searchParams.get('force') === '1'
  const limitParam = url.searchParams.get('limit')
  const costCapParam = url.searchParams.get('costCap')
  const limit = limitParam ? parseInt(limitParam, 10) : DEFAULT_CRON_LIMIT
  const costCapUsd = costCapParam ? parseFloat(costCapParam) : DEFAULT_COST_CAP_USD

  const lines: string[] = []
  const result = await runCurator(supabaseAdmin, {
    dryRun,
    force,
    limit: Number.isFinite(limit) ? limit : DEFAULT_CRON_LIMIT,
    costCapUsd: Number.isFinite(costCapUsd) ? costCapUsd : DEFAULT_COST_CAP_USD,
    logger: (m) => lines.push(m),
  })

  return NextResponse.json({
    ...result,
    log: lines,
  })
}

/**
 * POST /api/curate
 *
 * Same as GET — so cron systems that prefer POST (and an ops-dashboard
 * "Run curator now" button) work without contortion.
 */
export async function POST(req: NextRequest) {
  return GET(req)
}
