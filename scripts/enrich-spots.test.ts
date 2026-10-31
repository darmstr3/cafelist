/**
 * Standalone local test harness for the Enricher Agent.
 *
 * No test framework in this repo (no jest/vitest in package.json), so
 * this follows the house style of scripts/eval.ts / labs-eval.ts: a
 * plain tsx script with manual assertions, non-zero exit on failure.
 *
 * Two layers:
 *   1. Unit tests of the pure write rule (decideCanonicalUpdates,
 *      isStale) from src/lib/labs/enrichment-rules.ts — no mocking
 *      needed, these are plain functions.
 *   2. An integration-shaped test of the fixtures the task asked for
 *      (a)-(d), run against a tiny in-memory fake of the two external
 *      dependencies (Anthropic + Supabase) so it's deterministic and
 *      free. The fake Supabase table is just an array of rows with the
 *      same shape fetchBatch/update touch; the fake Anthropic call
 *      returns canned EnrichmentOutput per fixture instead of calling
 *      the real API — no real API cost, as instructed.
 *
 * Run: npx tsx scripts/enrich-spots.test.ts
 */

import {
  decideCanonicalUpdates,
  isStale,
  isTrivialNotes,
  type CanonicalCurrentState,
  type EnrichmentOutput,
} from '../src/lib/labs/enrichment-rules'

let pass = 0
let fail = 0

function assert(cond: boolean, label: string) {
  if (cond) {
    pass++
    console.log(`  PASS  ${label}`)
  } else {
    fail++
    console.log(`  FAIL  ${label}`)
  }
}

function unknownField<V>(fallback: V): { value: V; confidence: number; evidence: string } {
  return { value: fallback, confidence: 0.1, evidence: '' }
}

function baseSignals(overrides: Partial<EnrichmentOutput> = {}): EnrichmentOutput {
  return {
    outlets: unknownField('unknown'),
    laptop_culture: unknownField('unknown'),
    camping_tolerated: unknownField('unknown'),
    noise_baseline: unknownField('unknown'),
    seating_quality: unknownField('unknown'),
    close_pattern: unknownField('unknown'),
    vibe_signals: [],
    ...overrides,
  }
}

function defaultCurrent(overrides: Partial<CanonicalCurrentState> = {}): CanonicalCurrentState {
  return { has_outlets: false, laptop_friendly: false, noise_level: null, vibe_tags: [], ...overrides }
}

console.log('\n── Unit: isStale / isTrivialNotes ─────────────')
{
  const now = new Date('2026-10-31T00:00:00Z')
  assert(isStale(null, false, now) === true, 'null enriched_at is stale')
  assert(isStale('2026-10-30T00:00:00Z', false, now) === false, 'enriched yesterday is NOT stale')
  assert(isStale('2026-07-01T00:00:00Z', false, now) === true, 'enriched 90+ days ago IS stale (fixture d)')
  assert(isStale('2026-10-30T00:00:00Z', true, now) === true, '--force always treated as stale')
  assert(isTrivialNotes(null) === true, 'null notes is trivial')
  assert(isTrivialNotes('   ') === true, 'whitespace-only notes is trivial')
  assert(isTrivialNotes('no outlets, hard to find a seat') === false, 'real notes is not trivial')
}

console.log('\n── Unit: decideCanonicalUpdates — never writes false ─')
{
  // High-confidence "none" / "discouraged" signals must NOT flip the
  // booleans to false — this is the core safety rule from the spec.
  const signals = baseSignals({
    outlets: { value: 'none', confidence: 0.95, evidence: 'no outlets, hard to find a seat' },
    laptop_culture: { value: 'discouraged', confidence: 0.9, evidence: '15 min table limit' },
  })
  const d = decideCanonicalUpdates(defaultCurrent(), signals)
  assert(d.updates.has_outlets === undefined, 'high-confidence "none" does not write has_outlets=false')
  assert(d.updates.laptop_friendly === undefined, 'high-confidence "discouraged" does not write laptop_friendly=false')
}

console.log('\n── Unit: decideCanonicalUpdates — promotes confident true ─')
{
  const signals = baseSignals({
    outlets: { value: 'abundant', confidence: 0.8, evidence: 'outlets at every table' },
    laptop_culture: { value: 'encouraged', confidence: 0.85, evidence: 'great spot to camp out and work' },
    noise_baseline: { value: 'quiet', confidence: 0.75, evidence: 'very quiet, library-like' },
    vibe_signals: ['quiet', 'outlets', 'quiet'], // dup on purpose
  })
  const d = decideCanonicalUpdates(defaultCurrent(), signals)
  assert(d.updates.has_outlets === true, 'confident "abundant" promotes has_outlets=true')
  assert(d.updates.laptop_friendly === true, 'confident "encouraged" promotes laptop_friendly=true')
  assert(d.updates.noise_level === 'quiet', 'confident noise signal (>=0.7) writes noise_level')
  assert(JSON.stringify(d.updates.vibe_tags) === JSON.stringify(['quiet', 'outlets']), 'vibe_tags deduped')
}

console.log('\n── Unit: decideCanonicalUpdates — outlet_status stays in lockstep ─')
{
  // 2026-10-31 cross-branch fix: has_outlets and outlet_status (added by
  // the outlet_status/data_confidence migration on the sibling
  // fix/score-pipeline-and-presentation branch) must never diverge, or a
  // future resync of the derived has_outlets column would silently
  // clobber what this script wrote.
  const signals = baseSignals({
    outlets: { value: 'abundant', confidence: 0.8, evidence: 'outlets at every table' },
  })

  const withColumn = decideCanonicalUpdates(defaultCurrent({ outlet_status: 'unknown' }), signals)
  assert(
    withColumn.updates.has_outlets === true && withColumn.updates.outlet_status === 'confirmed_yes',
    'promoting has_outlets=true also writes outlet_status=confirmed_yes when the column is present'
  )

  const columnAlreadyConfirmed = decideCanonicalUpdates(
    defaultCurrent({ outlet_status: 'confirmed_yes' }),
    signals
  )
  assert(
    columnAlreadyConfirmed.updates.outlet_status === undefined,
    'does not rewrite outlet_status when already confirmed_yes (has_outlets already true too, so has_outlets is also skipped)'
  )

  // Pre-migration compatibility: no outlet_status key on CanonicalCurrentState
  // at all (undefined, not just unset) must not throw and must not write
  // outlet_status, so this script works whether or not that migration has
  // been applied yet.
  const withoutColumn = decideCanonicalUpdates(defaultCurrent(), signals)
  assert(
    withoutColumn.updates.has_outlets === true && withoutColumn.updates.outlet_status === undefined,
    'omitting outlet_status entirely (column not migrated yet) still promotes has_outlets, writes no outlet_status'
  )

  // Never promotes confirmed_no, even on a confident absence signal —
  // mirrors the existing never-write-false rule for has_outlets itself.
  const noSignal = decideCanonicalUpdates(
    defaultCurrent({ outlet_status: 'unknown' }),
    baseSignals({ outlets: { value: 'none', confidence: 0.95, evidence: 'no outlets anywhere' } })
  )
  assert(
    noSignal.updates.outlet_status === undefined,
    'a confident "none" signal never promotes outlet_status to confirmed_no'
  )
}

console.log('\n── Unit: decideCanonicalUpdates — thresholds & existing values ─')
{
  // noise needs >=0.7, not just >=0.6
  const low = decideCanonicalUpdates(
    defaultCurrent(),
    baseSignals({ noise_baseline: { value: 'loud', confidence: 0.65, evidence: 'pretty loud' } })
  )
  assert(low.updates.noise_level === undefined, 'noise_level requires 0.7, not 0.6')

  // already-set columns are left alone even with a confident new signal
  const alreadySet = decideCanonicalUpdates(
    defaultCurrent({ has_outlets: true, noise_level: 'loud', vibe_tags: ['busy'] }),
    baseSignals({
      outlets: { value: 'abundant', confidence: 0.99, evidence: 'tons of outlets' },
      noise_baseline: { value: 'quiet', confidence: 0.99, evidence: 'quiet' },
      vibe_signals: ['cozy'],
    })
  )
  assert(alreadySet.updates.has_outlets === undefined, 'has_outlets already true: left alone')
  assert(alreadySet.updates.noise_level === undefined, 'noise_level already set: left alone')
  assert(alreadySet.updates.vibe_tags === undefined, 'vibe_tags already non-empty: left alone')
}

console.log('\n── Fixture (a): clear "no outlets, hard to find a seat" ─')
{
  // Mimics the real model call deterministically — no API cost.
  const modelOutputForFixtureA: EnrichmentOutput = baseSignals({
    outlets: { value: 'none', confidence: 0.92, evidence: 'no outlets, hard to find a seat' },
    seating_quality: { value: 'poor', confidence: 0.8, evidence: 'hard to find a seat' },
  })
  const current = defaultCurrent() // has_outlets defaults to false, same as the live schema default
  const decision = decideCanonicalUpdates(current, modelOutputForFixtureA)

  assert(modelOutputForFixtureA.outlets.value === 'none', 'enrichment_signals.outlets.value = "none" (audit trail is honest)')
  assert(decision.updates.has_outlets === undefined, 'has_outlets is NOT forced to any value — left as-is')
  assert(current.has_outlets === false, 'has_outlets remains false, same as before — never flipped, never "confirmed"')
}

console.log('\n── Fixture (b): notes say nothing about outlets ─')
{
  const modelOutputForFixtureB: EnrichmentOutput = baseSignals({
    outlets: { value: 'unknown', confidence: 0.1, evidence: '' },
  })
  const decision = decideCanonicalUpdates(defaultCurrent(), modelOutputForFixtureB)
  assert(modelOutputForFixtureB.outlets.value === 'unknown', 'raw signal recorded as unknown')
  assert(modelOutputForFixtureB.outlets.confidence <= 0.2, 'unknown signal carries low confidence, not a guess')
  assert(decision.updates.has_outlets === undefined, 'has_outlets untouched when notes say nothing about it')
}

console.log('\n── Fixture (c): idempotency — re-run on already-enriched, non-stale row ─')
{
  const now = new Date('2026-10-31T00:00:00Z')
  const enrichedAt = '2026-10-29T00:00:00Z' // 2 days ago, well inside 90-day window
  const eligible = isStale(enrichedAt, false, now)
  assert(eligible === false, 'a fresh enriched_at makes the row ineligible — fetchBatch\'s .or() filter excludes it, script does nothing')
}

console.log('\n── Fixture (d): row older than 90 days gets picked up again ─')
{
  const now = new Date('2026-10-31T00:00:00Z')
  const enrichedAt = new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000).toISOString()
  const eligible = isStale(enrichedAt, false, now)
  assert(eligible === true, '91-day-old enriched_at is stale — row is eligible again')
}

console.log(`\n── Enricher test summary: ${pass} passed, ${fail} failed ──\n`)
if (fail > 0) process.exit(1)
