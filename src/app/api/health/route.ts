import { NextResponse } from 'next/server'
import { supabase, supabaseAdmin } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────
// /api/health — observability canary.
//
// Designed to fail in the same way the app fails so external
// monitors can detect real outages, not just "the lambda boots."
//
// Checks:
//   1. Required env vars are present (and not placeholders)
//   2. The exact query the homepage runs (anon SELECT with RLS)
//      succeeds against the `spots` table.
//   3. The admin client can also read.
//   4. Read latency is reasonable.
//
// Response shape is stable so the dashboard / cron agent can
// parse it. Returns 200 if everything is healthy, 503 otherwise.
// ─────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Status = 'ok' | 'degraded' | 'down'

interface CheckResult {
  ok: boolean
  status: Status
  ms?: number
  detail?: string
  error?: string
}

interface HealthResponse {
  status: Status
  timestamp: string
  uptime_s: number
  region: string | null
  commit: string | null
  checks: {
    env: CheckResult
    supabase_anon_read: CheckResult
    supabase_admin_read: CheckResult
  }
}

const REQUIRED_PUBLIC_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
]
const REQUIRED_SERVER_ENV = [
  'SUPABASE_SERVICE_ROLE_KEY',
]

function checkEnv(): CheckResult {
  const missing: string[] = []
  const placeholders: string[] = []
  for (const k of [...REQUIRED_PUBLIC_ENV, ...REQUIRED_SERVER_ENV]) {
    const v = process.env[k]
    if (!v) missing.push(k)
    else if (v.toLowerCase().includes('placeholder')) placeholders.push(k)
  }
  if (missing.length > 0) {
    return { ok: false, status: 'down', error: `missing env: ${missing.join(', ')}` }
  }
  if (placeholders.length > 0) {
    return { ok: false, status: 'down', error: `placeholder env: ${placeholders.join(', ')}` }
  }
  return { ok: true, status: 'ok', detail: 'all required env vars present' }
}

async function checkSupabaseAnonRead(): Promise<CheckResult> {
  const start = Date.now()
  try {
    // Mirror the exact query the homepage runs so this fails when
    // the homepage fails (RLS, missing column, network, etc.)
    const { data, error } = await supabase
      .from('spots')
      .select('id')
      .eq('status', 'approved')
      .limit(1)

    const ms = Date.now() - start
    if (error) {
      return {
        ok: false,
        status: 'down',
        ms,
        error: `${error.code ?? 'unknown'}: ${error.message}`,
      }
    }
    if (ms > 2000) {
      return {
        ok: true,
        status: 'degraded',
        ms,
        detail: `slow read (${ms}ms), got ${data?.length ?? 0} row(s)`,
      }
    }
    return {
      ok: true,
      status: 'ok',
      ms,
      detail: `read ${data?.length ?? 0} row(s)`,
    }
  } catch (err: unknown) {
    return {
      ok: false,
      status: 'down',
      ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function checkSupabaseAdminRead(): Promise<CheckResult> {
  const start = Date.now()
  try {
    const { count, error } = await supabaseAdmin
      .from('spots')
      .select('id', { count: 'exact', head: true })

    const ms = Date.now() - start
    if (error) {
      return {
        ok: false,
        status: 'down',
        ms,
        error: `${error.code ?? 'unknown'}: ${error.message}`,
      }
    }
    return {
      ok: true,
      status: ms > 2000 ? 'degraded' : 'ok',
      ms,
      detail: `${count ?? 0} total spots`,
    }
  } catch (err: unknown) {
    return {
      ok: false,
      status: 'down',
      ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function rollupStatus(checks: CheckResult[]): Status {
  if (checks.some((c) => c.status === 'down')) return 'down'
  if (checks.some((c) => c.status === 'degraded')) return 'degraded'
  return 'ok'
}

export async function GET() {
  const env = checkEnv()

  // If env is broken, don't bother making DB calls — they'll fail
  // for an unrelated reason and pollute the report.
  let supabase_anon_read: CheckResult
  let supabase_admin_read: CheckResult
  if (!env.ok) {
    supabase_anon_read = { ok: false, status: 'down', error: 'skipped: env check failed' }
    supabase_admin_read = { ok: false, status: 'down', error: 'skipped: env check failed' }
  } else {
    ;[supabase_anon_read, supabase_admin_read] = await Promise.all([
      checkSupabaseAnonRead(),
      checkSupabaseAdminRead(),
    ])
  }

  const status = rollupStatus([env, supabase_anon_read, supabase_admin_read])

  const body: HealthResponse = {
    status,
    timestamp: new Date().toISOString(),
    uptime_s: Math.round(process.uptime()),
    region: process.env.VERCEL_REGION ?? null,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    checks: {
      env,
      supabase_anon_read,
      supabase_admin_read,
    },
  }

  return NextResponse.json(body, {
    status: status === 'down' ? 503 : 200,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  })
}
