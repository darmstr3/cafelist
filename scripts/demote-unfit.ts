// ─────────────────────────────────────────────────────────────
// scripts/demote-unfit.ts
//
// Editorial demotion: pull currently-APPROVED spots whose Curator
// workability_score is below the "unfit" bar out of public visibility.
//
// Why: a one-time bulk backfill (scripts/flood-nyc.ts, 2026-05-25) left
// ~100 spots approved with workability_score < 4 — places where you'd
// feel awkward opening a laptop for 2 hours. They were appearing on the
// public homepage. The homepage now gates at workability >= 6
// (src/lib/quality.ts), but the underlying rows are still status='approved'
// in the DB; this script demotes the worst of them so the data matches the
// promise.
//
// Target: status='approved' AND workability_score < UNFIT_WORKABILITY_MAX (4).
// Rows with NULL workability_score are NEVER touched (they're unscored, not
// judged unfit). The 4–6 "friction" band is also left alone for separate
// triage.
//
// The `spot_status` enum is {pending, approved, rejected} — there is no
// 'archived' value, and adding one is a schema change to a production enum.
// So demotion sets status='rejected' for now.
//
// ── SAFETY
//   * DRY-RUN BY DEFAULT. Prints exactly what it would change and exits.
//   * Mutates the DB only when passed --execute.
//   * Read-only counts are printed BEFORE any write.
//   * Does NOT ingest, fetch, or create any spots. Demotion only.
//
// ── Usage
//   npx tsx scripts/demote-unfit.ts              # dry-run: show counts + sample
//   npx tsx scripts/demote-unfit.ts --execute    # apply: approved -> rejected
//
// Run LOCALLY — needs the Supabase service-role key from .env.local.
// ─────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { UNFIT_WORKABILITY_MAX } from '../src/lib/quality'

// ── Env loader (mirrors scripts/flood-nyc.ts) ─────────────────
function loadEnv() {
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const val = trimmed.slice(eq + 1).trim()
      if (key && !(key in process.env)) process.env[key] = val
    }
  } catch {
    // .env.local missing — rely on ambient process.env
  }
}

interface UnfitRow {
  id: string
  name: string
  neighborhood: string | null
  workability_score: number | null
}

async function main() {
  loadEnv()

  const EXECUTE = process.argv.slice(2).includes('--execute')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error('[demote] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
    process.exit(1)
  }

  const db = createClient(url, serviceKey, { auth: { persistSession: false } })

  console.log('── Demote unfit spots ─────────────────────────')
  console.log(`mode:      ${EXECUTE ? 'EXECUTE (will write)' : 'DRY RUN (no writes)'}`)
  console.log(`target:    status='approved' AND workability_score < ${UNFIT_WORKABILITY_MAX}`)
  console.log(`action:    status -> 'rejected'`)
  console.log('')

  // ── Read-only: what's currently public and what we'd demote ──
  const { count: approvedCount, error: cErr } = await db
    .from('spots')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'approved')
  if (cErr) {
    console.error('[demote] Failed to count approved spots:', cErr.message)
    process.exit(1)
  }

  // .lt excludes NULL workability_score — unscored rows are never targeted.
  const { data, error } = await db
    .from('spots')
    .select('id, name, neighborhood, workability_score')
    .eq('status', 'approved')
    .lt('workability_score', UNFIT_WORKABILITY_MAX)
    .order('workability_score', { ascending: true })

  if (error) {
    console.error('[demote] Failed to read target rows:', error.message)
    process.exit(1)
  }

  const rows = (data ?? []) as UnfitRow[]

  console.log(`approved spots (currently public-eligible by status): ${approvedCount ?? '?'}`)
  console.log(`approved + unfit (workability < ${UNFIT_WORKABILITY_MAX}) to demote:   ${rows.length}`)
  console.log('')

  if (rows.length === 0) {
    console.log('Nothing to demote. Exiting.')
    return
  }

  const sample = rows.slice(0, 25)
  console.log(`Sample (${sample.length} of ${rows.length}):`)
  for (const r of sample) {
    const score = r.workability_score == null ? 'null' : r.workability_score.toFixed(1)
    console.log(`  ${score.padStart(4)}  ${r.name}${r.neighborhood ? ` — ${r.neighborhood}` : ''}`)
  }
  if (rows.length > sample.length) console.log(`  … and ${rows.length - sample.length} more`)
  console.log('')

  if (!EXECUTE) {
    console.log('DRY RUN — no changes made.')
    console.log('Re-run with --execute to demote these rows to status=rejected.')
    return
  }

  // ── Write path ───────────────────────────────────────────────
  const ids = rows.map((r) => r.id)
  const { error: upErr, count: updated } = await db
    .from('spots')
    .update({ status: 'rejected' }, { count: 'exact' })
    .in('id', ids)

  if (upErr) {
    console.error('[demote] Update failed:', upErr.message)
    process.exit(1)
  }

  console.log(`Demoted ${updated ?? ids.length} spot(s) to status='rejected'.`)

  // ── Post-state confirmation ──────────────────────────────────
  const { count: remaining } = await db
    .from('spots')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'approved')
    .lt('workability_score', UNFIT_WORKABILITY_MAX)

  console.log(`Remaining approved + unfit (workability < ${UNFIT_WORKABILITY_MAX}): ${remaining ?? '?'} (expect 0)`)
}

main().catch((e) => {
  console.error('[demote] FATAL:', e)
  process.exit(1)
})
