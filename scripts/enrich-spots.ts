/**
 * Cafelist — Enricher
 *
 * For every approved spot, mines the notes field (which carries review text
 * excerpts from import-nyc.ts) for structured workability signals and writes
 * them back to the canonical columns (has_outlets, laptop_friendly, etc.).
 *
 * Why this exists:
 *   Scout/import populate spots from Google Places metadata, but Places
 *   only reliably gives wifi (and even that is defaulted true here, not
 *   actually verified). Fields like has_outlets are 10% populated and stay
 *   false-by-default for the rest, which the Curator then treats as a
 *   negative signal — "lacks outlets". That sinks workability_score below
 *   the viable threshold (6) for spots that, per review text, clearly do
 *   have outlets.
 *
 *   This script reads what reviewers already wrote and pulls the structured
 *   answer out. Curator runs again afterward with richer inputs.
 *
 * Cost model:
 *   Pure LLM (Haiku). No Google Places calls. Per-spot ~$0.005–0.015 on
 *   a typical 200–800 char notes payload. 535 approved spots ≈ $5–8.
 *
 * Modes — same script:
 *   - Backfill:    re-enrich every row with no enrichment timestamp
 *   - Stale-pass:  re-enrich rows whose enriched_at < now-90d (notes can
 *                  change as more reviews come in via Scout updates)
 *
 * Idempotent: re-running picks up only un-enriched / stale rows.
 *
 * Usage:
 *   npx tsx scripts/enrich-spots.ts                       # full pass
 *   npx tsx scripts/enrich-spots.ts --dry-run             # call LLM, don't write
 *   npx tsx scripts/enrich-spots.ts --limit=20            # cap rows processed
 *   npx tsx scripts/enrich-spots.ts --cost-cap=10.0       # USD ceiling (default 10)
 *   npx tsx scripts/enrich-spots.ts --force               # re-enrich everyone
 *   npx tsx scripts/enrich-spots.ts --concurrency=4       # parallel calls
 *   npx tsx scripts/enrich-spots.ts --neighborhood=Bushwick  # restrict to one hood
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { callClaudeJson, DEFAULT_MODEL } from '../src/lib/labs/anthropic'
import type { Spot } from '../src/types'

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
// Default 2 (was 4) — see same rationale in curate-workability.ts. Full-table
// runs at concurrency=4 trip Anthropic Tier 1 rate limits.
const CONCURRENCY = concurrencyArg ? Math.max(1, parseInt(concurrencyArg.split('=')[1], 10)) : 2
const NEIGHBORHOOD_FILTER = neighborhoodArg ? neighborhoodArg.split('=')[1] : null

const STALENESS_DAYS = 90
const PAGE_SIZE = 50

// ── Env loading ───────────────────────────────────────────────

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
    /* fall back to ambient env */
  }
}

loadEnv()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[enrich] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('[enrich] Missing ANTHROPIC_API_KEY.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── Prompt ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Cafelist Enricher. You read the notes/reviews/metadata for a single venue and extract structured workability signals.

For each signal below, choose ONE value, and provide a confidence score (0.0–1.0) plus a brief evidence quote when possible. Use "unknown" generously — DO NOT guess. If the notes don't mention outlets at all, return "unknown" with low confidence, NOT "no".

Signals:
- outlets: "abundant" | "some" | "rare" | "none" | "unknown"
    → "abundant" only if explicitly described as plentiful (e.g. "outlets at every seat")
    → "some" if mentioned as available
    → "rare"/"none" only if reviewers complain about lack of outlets
    → "unknown" otherwise
- laptop_culture: "encouraged" | "tolerated" | "discouraged" | "unknown"
    → "encouraged" = dedicated work seating, "laptop pods", explicit work-friendly marketing
    → "tolerated" = laptops are common, no signs of pushback
    → "discouraged" = "no laptops" sign, peak-hour limits, time caps
    → "unknown" otherwise
- camping_tolerated: true | false | "unknown"
    → true if reviews mention multi-hour stays positively
    → false if reviews mention time pressure, hovering staff, "you can tell they want you to leave"
- noise_baseline: "silent" | "quiet" | "moderate" | "loud" | "unknown"
    → from review descriptions of atmosphere
- seating_quality: "ample" | "limited" | "poor" | "unknown"
    → seat count + comfort, not aesthetics
- close_pattern: "early" | "standard" | "late" | "24hr" | "unknown"
    → "early" = closes before 6pm
    → "standard" = closes 6-9pm
    → "late" = closes 9pm or later
    → "24hr" = open 24 hours
- vibe_signals: array of short tags drawn from the notes (max 5). Examples:
    ["natural light", "communal table", "quiet corners", "fast wifi mentioned",
     "outdoor seating", "designated work area", "no laptops sign", "tight quarters"]

Return ONLY a JSON object with this exact shape, no prose, no markdown:
{
  "outlets":             { "value": "<one of above>", "confidence": <0-1>, "evidence": "<short quote or empty>" },
  "laptop_culture":      { "value": "<one of above>", "confidence": <0-1>, "evidence": "<short quote or empty>" },
  "camping_tolerated":   { "value": <true|false|"unknown">, "confidence": <0-1>, "evidence": "<short quote or empty>" },
  "noise_baseline":      { "value": "<one of above>", "confidence": <0-1>, "evidence": "<short quote or empty>" },
  "seating_quality":     { "value": "<one of above>", "confidence": <0-1>, "evidence": "<short quote or empty>" },
  "close_pattern":       { "value": "<one of above>", "confidence": <0-1>, "evidence": "<short quote or empty>" },
  "vibe_signals":        ["tag1", "tag2", ...]
}`

interface SignalField<T> {
  value: T
  confidence: number
  evidence: string
}

interface EnrichmentOutput {
  outlets: SignalField<'abundant' | 'some' | 'rare' | 'none' | 'unknown'>
  laptop_culture: SignalField<'encouraged' | 'tolerated' | 'discouraged' | 'unknown'>
  camping_tolerated: SignalField<true | false | 'unknown'>
  noise_baseline: SignalField<'silent' | 'quiet' | 'moderate' | 'loud' | 'unknown'>
  seating_quality: SignalField<'ample' | 'limited' | 'poor' | 'unknown'>
  close_pattern: SignalField<'early' | 'standard' | 'late' | '24hr' | 'unknown'>
  vibe_signals: string[]
}

// ── Helpers ───────────────────────────────────────────────────

function spotToPayload(spot: Spot) {
  return {
    name: spot.name,
    type: spot.type,
    city: spot.city,
    neighborhood: spot.neighborhood,
    address: spot.address,
    hours: spot.hours,
    current_vibe_tags: spot.vibe_tags ?? [],
    current_noise_level: spot.noise_level,
    current_seating_comfort: spot.seating_comfort,
    notes: spot.notes ?? '',
  }
}

const CONFIDENCE_THRESHOLD = 0.6

/** Map enrichment signals back to canonical spot columns. Only overwrite
 * a column when confidence is high enough — otherwise leave the existing
 * value alone. */
function signalsToColumnUpdates(signals: EnrichmentOutput, spot: Spot) {
  const updates: Record<string, unknown> = {}

  // has_outlets: true only for abundant/some at decent confidence
  if (signals.outlets.confidence >= CONFIDENCE_THRESHOLD) {
    if (signals.outlets.value === 'abundant' || signals.outlets.value === 'some') {
      updates.has_outlets = true
    } else if (signals.outlets.value === 'none' || signals.outlets.value === 'rare') {
      updates.has_outlets = false
    }
  }

  // laptop_friendly: encouraged/tolerated → true, discouraged → false
  if (signals.laptop_culture.confidence >= CONFIDENCE_THRESHOLD) {
    if (
      signals.laptop_culture.value === 'encouraged' ||
      signals.laptop_culture.value === 'tolerated'
    ) {
      updates.laptop_friendly = true
    } else if (signals.laptop_culture.value === 'discouraged') {
      updates.laptop_friendly = false
    }
  }

  // noise_level: only overwrite if existing is the default ("moderate") AND
  // enricher has high confidence in a non-moderate value. Don't fight real
  // import-time data.
  if (
    spot.noise_level === 'moderate' &&
    signals.noise_baseline.confidence >= 0.7 &&
    signals.noise_baseline.value !== 'unknown' &&
    signals.noise_baseline.value !== 'moderate'
  ) {
    updates.noise_level = signals.noise_baseline.value
  }

  // Merge vibe_signals into vibe_tags (dedupe, cap at 10).
  if (signals.vibe_signals && signals.vibe_signals.length > 0) {
    const existing = new Set((spot.vibe_tags ?? []).map((t) => t.toLowerCase()))
    const additions = signals.vibe_signals
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t && !existing.has(t))
    if (additions.length > 0) {
      updates.vibe_tags = [...(spot.vibe_tags ?? []), ...additions].slice(0, 10)
    }
  }

  return updates
}

async function enrichSpot(
  spot: Spot
): Promise<
  | { ok: true; signals: EnrichmentOutput; updates: Record<string, unknown>; costUsd: number }
  | { ok: false; reason: string; costUsd: number }
> {
  const payload = spotToPayload(spot)
  const userMsg = `Extract signals for this venue:\n\n${JSON.stringify(payload, null, 2)}`

  try {
    const { data, usage } = await callClaudeJson<EnrichmentOutput>({
      system: SYSTEM_PROMPT,
      user: userMsg,
      maxTokens: 700,
    })
    const updates = signalsToColumnUpdates(data, spot)
    return { ok: true, signals: data, updates, costUsd: usage.estimatedCostUsd }
  } catch (e) {
    return { ok: false, reason: (e as Error).message, costUsd: 0 }
  }
}

// ── Fetch ─────────────────────────────────────────────────────

async function fetchBatch(offset: number): Promise<Spot[]> {
  let query = supabase
    .from('spots')
    .select('*')
    .eq('status', 'approved')
    .order('created_at', { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1)

  if (!isForce) {
    const staleCutoff = new Date(Date.now() - STALENESS_DAYS * 24 * 60 * 60 * 1000).toISOString()
    query = query.or(`enriched_at.is.null,enriched_at.lt.${staleCutoff}`)
  }
  if (NEIGHBORHOOD_FILTER) {
    query = query.eq('neighborhood', NEIGHBORHOOD_FILTER)
  }

  const { data, error } = await query
  if (error) throw new Error(`fetchBatch failed: ${error.message}`)
  return (data ?? []) as Spot[]
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

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log(
    `[enrich] Starting. dry-run=${isDryRun} force=${isForce} limit=${LIMIT === Infinity ? '∞' : LIMIT} cost-cap=$${COST_CAP_USD.toFixed(2)} concurrency=${CONCURRENCY} model=${DEFAULT_MODEL}${NEIGHBORHOOD_FILTER ? ` neighborhood=${NEIGHBORHOOD_FILTER}` : ''}`
  )

  let totalCostUsd = 0
  let processed = 0
  let updated = 0
  let failed = 0
  let offset = 0
  let costCapHit = false

  // Track field-level write counts for the summary.
  const fieldWrites = {
    has_outlets_true: 0,
    has_outlets_false: 0,
    laptop_friendly_true: 0,
    laptop_friendly_false: 0,
    noise_level_changed: 0,
    vibe_tags_added: 0,
  }

  outer: while (processed < LIMIT) {
    const batch = await fetchBatch(offset)
    if (batch.length === 0) break

    const remaining = LIMIT - processed
    const work = batch.slice(0, remaining)
    offset += batch.length

    const results = await mapWithConcurrency(work, CONCURRENCY, async (spot, idx) => {
      const result = await enrichSpot(spot)
      const tag = result.ok
        ? `✓ ${Object.keys(result.updates).length} fields`
        : `✗ ${result.reason.slice(0, 80)}`
      console.log(
        `  [${String(processed + idx + 1).padStart(4)}] ${(spot.neighborhood ?? '—').padEnd(20)} ${spot.name.slice(0, 36).padEnd(36)} ${tag}`
      )
      return { spot, result }
    })

    for (const { spot, result } of results) {
      processed++
      totalCostUsd += result.costUsd
      if (!result.ok) {
        failed++
        continue
      }

      // Count field writes for the summary.
      if ('has_outlets' in result.updates) {
        if (result.updates.has_outlets) fieldWrites.has_outlets_true++
        else fieldWrites.has_outlets_false++
      }
      if ('laptop_friendly' in result.updates) {
        if (result.updates.laptop_friendly) fieldWrites.laptop_friendly_true++
        else fieldWrites.laptop_friendly_false++
      }
      if ('noise_level' in result.updates) fieldWrites.noise_level_changed++
      if ('vibe_tags' in result.updates) fieldWrites.vibe_tags_added++

      if (!isDryRun) {
        const { error } = await supabase
          .from('spots')
          .update({
            ...result.updates,
            enriched_at: new Date().toISOString(),
            enrichment_signals: result.signals,
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
          `[enrich] Cost cap $${COST_CAP_USD.toFixed(2)} reached after ${processed} rows (spent $${totalCostUsd.toFixed(4)}). Stopping.`
        )
        costCapHit = true
        break outer
      }
    }
  }

  console.log(`\n── Enricher summary ─────────────────────────`)
  console.log(`  processed:                ${processed}`)
  console.log(`  updated:                  ${updated}${isDryRun ? ' (dry-run, no writes)' : ''}`)
  console.log(`  failed:                   ${failed}`)
  console.log(`  cost (USD):               $${totalCostUsd.toFixed(4)}  (cap $${COST_CAP_USD.toFixed(2)}${costCapHit ? ' — HIT' : ''})`)
  console.log(`  has_outlets set to true:  ${fieldWrites.has_outlets_true}`)
  console.log(`  has_outlets set to false: ${fieldWrites.has_outlets_false}`)
  console.log(`  laptop_friendly true:     ${fieldWrites.laptop_friendly_true}`)
  console.log(`  laptop_friendly false:    ${fieldWrites.laptop_friendly_false}`)
  console.log(`  noise_level changed:      ${fieldWrites.noise_level_changed}`)
  console.log(`  vibe_tags merged:         ${fieldWrites.vibe_tags_added}`)

  if (failed > 0 && processed > 0 && failed / processed > 0.1) {
    console.error(
      `[enrich] WARN: ${failed}/${processed} rows failed (>10%). Failed rows will be retried next run.`
    )
  }
}

main().catch((e) => {
  console.error('[enrich] FATAL:', e)
  process.exit(1)
})
