/**
 * WorkSpot — Enricher Agent
 *
 * For every approved spot with notes text, asks Claude Haiku to mine
 * `notes` for structured workability signals (outlets, laptop culture,
 * camping tolerance, noise, seating, close-pattern, vibe tags) and:
 *
 *   1. Writes the full raw model output to `enrichment_signals` (jsonb)
 *      unconditionally — this is the audit trail, it always reflects
 *      what the model actually said.
 *   2. Promotes a signal into a canonical column (has_outlets,
 *      laptop_friendly, noise_level, vibe_tags) only when the write
 *      rule in src/lib/labs/enrichment-rules.ts says it's safe to.
 *      See that file's `decideCanonicalUpdates` doc comment for the
 *      full safety rule — short version: we never let an "unknown" or
 *      a low-confidence guess collapse into a canonical value, and we
 *      never write `false` to has_outlets/laptop_friendly since the
 *      live schema can't distinguish "confirmed false" from "default".
 *   3. Sets `enriched_at = now()` on every successful call regardless
 *      of whether any canonical column changed, so the staleness gate
 *      below keeps working.
 *
 * This agent mines `notes` ONLY. It never calls Google Places or any
 * other external API — it's pure Anthropic cost, which is why the cost
 * estimate in the report is just "rows x $/call".
 *
 * Pattern-matched to scripts/curate-workability.ts: same env loading,
 * same Supabase client setup, same callClaudeJson/DEFAULT_MODEL helper,
 * same flag set, same "catch per-row errors and keep going" shape.
 *
 * Usage:
 *   npx tsx scripts/enrich-spots.ts                     # full pass
 *   npx tsx scripts/enrich-spots.ts --dry-run           # call LLM, don't write
 *   npx tsx scripts/enrich-spots.ts --limit=20          # cap rows processed
 *   npx tsx scripts/enrich-spots.ts --cost-cap=10       # USD ceiling (default 10)
 *   npx tsx scripts/enrich-spots.ts --force             # ignore staleness gate
 *   npx tsx scripts/enrich-spots.ts --concurrency=4     # parallel API calls (default 4)
 *   npx tsx scripts/enrich-spots.ts --neighborhood=SoHo # restrict to one neighborhood
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { callClaudeJson, DEFAULT_MODEL } from '../src/lib/labs/anthropic'
import {
  decideCanonicalUpdates,
  isTrivialNotes,
  STALENESS_DAYS,
  type EnrichmentOutput,
} from '../src/lib/labs/enrichment-rules'
import type { Spot } from '../src/types'

// enriched_at / enrichment_signals exist on the live `spots` table
// (verified read-only against information_schema) but aren't on the
// shared Spot type yet — extend locally rather than widen the shared
// type for a column pair only this script touches so far.
type EnrichableSpot = Spot & {
  enriched_at: string | null
  enrichment_signals: EnrichmentOutput | null
}

// ── Flags ─────────────────────────────────────────────────────

const args = process.argv.slice(2)
const isDryRun = args.includes('--dry-run')
const isForce = args.includes('--force')
const limitArg = args.find((a) => a.startsWith('--limit='))
const costCapArg = args.find((a) => a.startsWith('--cost-cap='))
const concurrencyArg = args.find((a) => a.startsWith('--concurrency='))
const neighborhoodArg = args.find((a) => a.startsWith('--neighborhood='))
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Number.POSITIVE_INFINITY
const COST_CAP_USD = costCapArg ? parseFloat(costCapArg.split('=')[1]) : 10.0
const CONCURRENCY = concurrencyArg ? Math.max(1, parseInt(concurrencyArg.split('=')[1], 10)) : 4
const NEIGHBORHOOD = neighborhoodArg ? neighborhoodArg.split('=')[1] : null

const PAGE_SIZE = 50

// ── Env loading (same pattern as curate-workability.ts) ───────

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env.local')
  try {
    const raw = fs.readFileSync(envPath, 'utf-8')
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
    // No .env.local — fall back to ambient env (CI, scheduled task, etc.).
  }
}

loadEnv()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[enricher] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('[enricher] Missing ANTHROPIC_API_KEY.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── Prompt ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Cafelist Enricher. You mine ONE venue's free-text review notes for structured workability signals. You do not know anything about this venue beyond the notes text given to you — do not use outside knowledge of the venue name/chain.

For every field below, if the notes text says nothing relevant to it, return "unknown" with a low confidence (<=0.2) and empty evidence. NEVER guess a specific value just to fill the field. Confidence must honestly reflect how directly the notes support the value — a passing, ambiguous mention should score low confidence even if you pick a specific value.

Return ONLY a JSON object with this exact shape, no prose, no markdown:
{
  "outlets": { "value": "abundant"|"some"|"rare"|"none"|"unknown", "confidence": 0-1, "evidence": "short quote or paraphrase, or empty string" },
  "laptop_culture": { "value": "encouraged"|"tolerated"|"discouraged"|"unknown", "confidence": 0-1, "evidence": "..." },
  "camping_tolerated": { "value": true|false|"unknown", "confidence": 0-1, "evidence": "..." },
  "noise_baseline": { "value": "silent"|"quiet"|"moderate"|"loud"|"unknown", "confidence": 0-1, "evidence": "..." },
  "seating_quality": { "value": "poor"|"fair"|"good"|"excellent"|"unknown", "confidence": 0-1, "evidence": "..." },
  "close_pattern": { "value": "rushes_near_close"|"no_pressure_near_close"|"unknown", "confidence": 0-1, "evidence": "..." },
  "vibe_signals": ["short lowercase tag", ...]   // up to 8, empty array if nothing mineable
}

"outlets" = how available power outlets are, from mentions of outlets/plugs/charging.
"laptop_culture" = whether the notes suggest laptops/working are welcomed, merely tolerated, or discouraged (e.g. "no laptops" signs, "15 minute table limit", vs "great for working all day").
"camping_tolerated" = whether notes suggest you can sit for a long session without pressure to leave.
"noise_baseline" = the ambient noise level implied by notes (not a rating of the music genre — how loud/quiet it generally is).
"seating_quality" = comfort/availability of seating implied by notes.
"close_pattern" = whether notes suggest you'll be rushed near closing time ("rushes_near_close"), or closing isn't a pressure point ("no_pressure_near_close", e.g. 24hr or notes never mention it being an issue).
"vibe_signals" = short descriptive tags actually supported by the notes text (e.g. "cozy", "communal table", "24hr", "no wifi mentioned"). Do not invent tags the notes don't support.`

interface SpotToEnrich {
  id: string
  name: string
  notes: string
}

function spotToPrompt(spot: SpotToEnrich) {
  return `Venue name (context only, do not use outside knowledge of it): ${spot.name}\n\nNotes text to mine:\n"""\n${spot.notes}\n"""`
}

// ── Model call ────────────────────────────────────────────────

async function enrichSpot(spot: SpotToEnrich): Promise<
  | { ok: true; signals: EnrichmentOutput; costUsd: number }
  | { ok: false; reason: string; costUsd: number }
> {
  try {
    const { data, usage } = await callClaudeJson<EnrichmentOutput>({
      system: SYSTEM_PROMPT,
      user: spotToPrompt(spot),
      maxTokens: 500,
    })
    if (!data || typeof data !== 'object' || !('outlets' in data)) {
      return { ok: false, reason: `malformed response: ${JSON.stringify(data)}`, costUsd: usage.estimatedCostUsd }
    }
    return { ok: true, signals: data, costUsd: usage.estimatedCostUsd }
  } catch (e) {
    return { ok: false, reason: (e as Error).message, costUsd: 0 }
  }
}

// ── Main loop ─────────────────────────────────────────────────

async function fetchBatch(offset: number): Promise<EnrichableSpot[]> {
  let query = supabase
    .from('spots')
    .select('*')
    .eq('status', 'approved')
    .not('notes', 'is', null)
    .order('created_at', { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1)

  if (NEIGHBORHOOD) {
    query = query.eq('neighborhood', NEIGHBORHOOD)
  }

  if (!isForce) {
    const staleCutoff = new Date(Date.now() - STALENESS_DAYS * 24 * 60 * 60 * 1000).toISOString()
    query = query.or(`enriched_at.is.null,enriched_at.lt.${staleCutoff}`)
  }

  const { data, error } = await query
  if (error) throw new Error(`fetchBatch failed: ${error.message}`)
  return ((data ?? []) as EnrichableSpot[]).filter((s) => !isTrivialNotes(s.notes))
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

async function main() {
  console.log(
    `[enricher] Starting. dry-run=${isDryRun} force=${isForce} limit=${LIMIT === Infinity ? '∞' : LIMIT} cost-cap=$${COST_CAP_USD.toFixed(2)} concurrency=${CONCURRENCY} neighborhood=${NEIGHBORHOOD ?? 'all'} model=${DEFAULT_MODEL}`
  )

  let totalCostUsd = 0
  let processed = 0
  let updated = 0
  let failed = 0
  let offset = 0
  let costCapHit = false
  const canonicalWriteCounts: Record<string, number> = {}

  outer: while (processed < LIMIT) {
    const batch = await fetchBatch(offset)
    if (batch.length === 0) break

    const remaining = LIMIT - processed
    const work = batch.slice(0, remaining)
    offset += batch.length

    const results = await mapWithConcurrency(work, CONCURRENCY, async (spot, idx) => {
      const result = await enrichSpot({ id: spot.id, name: spot.name, notes: spot.notes ?? '' })
      const tag = result.ok ? `✓ outlets=${result.signals.outlets.value}` : `✗ ${result.reason.slice(0, 80)}`
      console.log(
        `  [${String(processed + idx + 1).padStart(4)}] ${spot.name.slice(0, 38).padEnd(38)} ${tag}`
      )
      return { spot, result }
    })

    for (const { spot, result } of results) {
      processed++
      if (!result.ok) {
        failed++
        totalCostUsd += result.costUsd
        continue
      }
      totalCostUsd += result.costUsd

      const decision = decideCanonicalUpdates(
        {
          has_outlets: spot.has_outlets,
          laptop_friendly: spot.laptop_friendly,
          noise_level: spot.noise_level,
          vibe_tags: spot.vibe_tags ?? [],
          // outlet_status may not exist on `spot` until the
          // outlet_status/data_confidence migration has been applied
          // (supabase/migrations/20261031_outlet_status_and_data_confidence.sql).
          // Optional chaining here so this script works whether that
          // migration has landed yet or not — see enrichment-rules.ts.
          outlet_status: (spot as { outlet_status?: 'confirmed_yes' | 'confirmed_no' | 'unknown' }).outlet_status,
        },
        result.signals
      )
      for (const n of decision.notes) console.log(`         ${n}`)
      for (const field of Object.keys(decision.updates)) {
        canonicalWriteCounts[field] = (canonicalWriteCounts[field] ?? 0) + 1
      }

      if (!isDryRun) {
        const { error } = await supabase
          .from('spots')
          .update({
            enrichment_signals: result.signals,
            enriched_at: new Date().toISOString(),
            ...decision.updates,
          })
          .eq('id', spot.id)
        if (error) {
          console.error(`  ⚠ DB update failed for ${spot.id}: ${error.message}`)
          failed++
        } else {
          updated++
        }
      }

      if (totalCostUsd >= COST_CAP_USD) {
        console.warn(
          `[enricher] Cost cap $${COST_CAP_USD.toFixed(2)} reached after ${processed} rows (spent $${totalCostUsd.toFixed(4)}). Stopping.`
        )
        costCapHit = true
        break outer
      }
    }
  }

  console.log(`\n── Enricher summary ────────────────────────────`)
  console.log(`  processed:          ${processed}`)
  console.log(`  updated:            ${updated}${isDryRun ? ' (dry-run, no writes)' : ''}`)
  console.log(`  failed:             ${failed}`)
  console.log(`  cost (USD):         $${totalCostUsd.toFixed(4)}  (cap $${COST_CAP_USD.toFixed(2)}${costCapHit ? ' — HIT' : ''})`)
  console.log(`  canonical writes:   ${JSON.stringify(canonicalWriteCounts)}`)

  if (failed > 0 && processed > 0 && failed / processed > 0.1) {
    console.error(`[enricher] WARN: ${failed}/${processed} rows failed (>10%).`)
    process.exit(2)
  }
}

main().catch((e) => {
  console.error('[enricher] FATAL:', e)
  process.exit(1)
})
