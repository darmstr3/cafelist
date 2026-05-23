/**
 * WorkSpot — Scout Agent (CLI)
 *
 * Thin wrapper around src/lib/scout.ts so the script and the
 * /api/scout HTTP handler can never drift apart on logic, caps,
 * or query templates.
 *
 * Picks the highest-priority city that hasn't been scouted in
 * the last 7 days, asks Google Places for coffee shops / cafes
 * / hotel lobbies, dedupes by `google_place_id`, fetches reviews
 * for each new candidate, and inserts them into `spots` as
 * `status='pending'` with notes + vibe_tags populated from review
 * analysis.
 *
 * Scoring (workability_score) is intentionally left for the
 * Curator's daily pass.
 *
 * Cost caps:
 *   - $0.50 per run    (hard)
 *   - $3.00 per 24h    (hard)
 *
 * Each invocation writes one row to scout_runs (status starts as
 * 'running', gets finalized to 'success' / 'partial' / 'cap_hit'
 * / 'skipped' / 'error').
 *
 * Usage:
 *   npx tsx scripts/scout.ts                   # one run
 *   npx tsx scripts/scout.ts --dry-run         # don't insert / don't bill
 *   npx tsx scripts/scout.ts --city="Austin"   # force a specific city
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import { runScout, DAILY_CAP_USD, PER_RUN_CAP_USD } from '../src/lib/scout'

// ── Flags ─────────────────────────────────────────────────────

const isDryRun = process.argv.includes('--dry-run')
const cityArg = process.argv.find((a) => a.startsWith('--city='))
const FORCED_CITY = cityArg ? cityArg.split('=')[1] : null

// ── Env loading (mirrors import-nyc.ts) ──────────────────────

function loadEnv() {
  try {
    const raw = fs.readFileSync('.env.local', 'utf-8')
    for (const line of raw.split('\n')) {
      const [key, ...val] = line.split('=')
      if (key && !key.startsWith('#') && key.trim()) {
        process.env[key.trim()] = val.join('=').trim()
      }
    }
  } catch {
    // .env.local not found — rely on process.env
  }
}

loadEnv()

const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY ?? ''
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

function log(msg: string) {
  process.stdout.write(msg + '\n')
}

async function main() {
  if (!GOOGLE_KEY || GOOGLE_KEY.includes('placeholder')) {
    log('❌ GOOGLE_PLACES_API_KEY is not set in .env.local')
    process.exit(1)
  }
  if (!isDryRun && (!SUPABASE_URL || SUPABASE_URL.includes('placeholder') || !SUPABASE_SERVICE_KEY)) {
    log('❌ Supabase credentials missing. Use --dry-run to test without DB.')
    process.exit(1)
  }

  const db = createClient(
    SUPABASE_URL || 'https://placeholder.supabase.co',
    SUPABASE_SERVICE_KEY || 'placeholder',
  )

  log(`\n🔭 WorkSpot — Scout Agent`)
  log(`   Mode: ${isDryRun ? 'DRY RUN (no writes, no billing tracked)' : 'LIVE'}`)
  log(`   Caps: $${PER_RUN_CAP_USD.toFixed(2)}/run, $${DAILY_CAP_USD.toFixed(2)}/24h`)

  const result = await runScout(db, {
    dryRun: isDryRun,
    forcedCity: FORCED_CITY,
    logger: log,
  })

  log(`\n   ✅ Run complete`)
  log(`      Status:    ${result.status}`)
  log(`      Examined:  ${result.candidates_examined}`)
  log(`      Inserted:  ${result.candidates_inserted}`)
  log(`      Cost:      $${result.total_cost_usd.toFixed(4)}`)
  log(`      24h total: $${result.daily_spend_after.toFixed(4)} / $${DAILY_CAP_USD.toFixed(2)}`)
  if (result.error_message) log(`      Error:     ${result.error_message}`)
  log('')

  // Non-zero exit on hard error so the scheduled task can surface it.
  if (result.status === 'error') process.exit(2)
}

main().catch((err) => {
  log(`\n💥 Fatal: ${err.message}`)
  process.exit(1)
})
