// ─────────────────────────────────────────────────────────────
// Pure decision logic for the Enricher Agent (scripts/enrich-spots.ts).
//
// Split out from the script itself (unlike curate-workability.ts,
// which keeps its scoring logic inline) so the write-rule — the
// part of this feature that is genuinely safety-critical — can be
// unit tested without spinning up a Supabase client or an
// Anthropic client. See scripts/enrich-spots.test.ts.
// ─────────────────────────────────────────────────────────────

import type { NoiseLevel } from '../../types'

// ── Model output schema ──────────────────────────────────────
//
// One Haiku call per spot, mining `notes` only. Every non-array
// field is a {value, confidence, evidence} triple so the model
// has to show its work and so "unknown" is a first-class value
// instead of the model being forced to guess.

export type OutletsValue = 'abundant' | 'some' | 'rare' | 'none' | 'unknown'
export type LaptopCultureValue = 'encouraged' | 'tolerated' | 'discouraged' | 'unknown'
export type NoiseBaselineValue = NoiseLevel | 'unknown'
export type SeatingQualityValue = 'poor' | 'fair' | 'good' | 'excellent' | 'unknown'
// "close_pattern" is named in memory with no defined enum. Resolved here as
// "does the venue's notes text suggest you'll be rushed out near closing,
// or is closing time a non-event for someone camping with a laptop" —
// the one framing of "close pattern" that's actually a workability signal
// distinct from the other fields. Documented as a spec ambiguity in the report.
export type ClosePatternValue = 'rushes_near_close' | 'no_pressure_near_close' | 'unknown'

export interface SignalField<V> {
  value: V
  confidence: number // 0–1
  evidence: string // short quote/paraphrase from notes, or "" if unknown
}

export interface EnrichmentOutput {
  outlets: SignalField<OutletsValue>
  laptop_culture: SignalField<LaptopCultureValue>
  camping_tolerated: SignalField<boolean | 'unknown'>
  noise_baseline: SignalField<NoiseBaselineValue>
  seating_quality: SignalField<SeatingQualityValue>
  close_pattern: SignalField<ClosePatternValue>
  /** Free-text vibe tags mined from notes. No per-item confidence —
   * see CanonicalUpdateInputs.vibeTagsCurrentlyEmpty for how this is gated. */
  vibe_signals: string[]
}

// ── Write-rule inputs/outputs ─────────────────────────────────

/** The subset of current spot state the write rule needs to decide
 * what, if anything, to overwrite. Deliberately narrow (not the whole
 * Spot) so tests can construct fixtures without the full row shape. */
export interface CanonicalCurrentState {
  has_outlets: boolean
  laptop_friendly: boolean
  noise_level: NoiseLevel | null
  vibe_tags: string[]
}

export interface CanonicalUpdates {
  has_outlets?: true
  laptop_friendly?: true
  noise_level?: NoiseLevel
  vibe_tags?: string[]
}

export interface CanonicalDecision {
  updates: CanonicalUpdates
  /** Human-readable reasons each field was or wasn't written, for logs. */
  notes: string[]
}

export const OUTLETS_CONFIDENCE_THRESHOLD = 0.6
export const LAPTOP_CONFIDENCE_THRESHOLD = 0.6
export const NOISE_CONFIDENCE_THRESHOLD = 0.7 // per memory, stricter than the others
export const VIBE_TAG_MAX = 8

/**
 * Decide which canonical columns to overwrite, given the model's raw
 * signals and the spot's current canonical values.
 *
 * CRITICAL SAFETY RULE (see report for full writeup): has_outlets and
 * laptop_friendly are NOT NULL booleans that default to `false` on the
 * live table — there is no way to tell "confirmed false" apart from
 * "never set, sitting at the default". Because of that, this function
 * NEVER writes `false` to either column, no matter how confident the
 * model is that notes say "no outlets" — that finding still lands in
 * enrichment_signals (the audit trail) unconditionally, it's just never
 * promoted into the boolean. We only ever promote a *true* reading, and
 * only when the column is currently false (so we're not clobbering a
 * true some other agent — e.g. Scout's review-mining — already set).
 *
 * noise_level and vibe_tags don't have this problem: noise_level is
 * nullable (NULL is a real "unset" sentinel) and an empty vibe_tags
 * array is the column default with no legitimate "someone deliberately
 * set it to empty" case in this product. Both are only written when
 * currently at their unset state.
 */
export function decideCanonicalUpdates(
  current: CanonicalCurrentState,
  signals: EnrichmentOutput
): CanonicalDecision {
  const updates: CanonicalUpdates = {}
  const notes: string[] = []

  // ── has_outlets: only ever promote to true ──
  if (current.has_outlets) {
    notes.push('has_outlets: skip (already true, not touching)')
  } else if (signals.outlets.value === 'unknown') {
    notes.push('has_outlets: skip (signal unknown)')
  } else if (signals.outlets.confidence < OUTLETS_CONFIDENCE_THRESHOLD) {
    notes.push(`has_outlets: skip (confidence ${signals.outlets.confidence} < ${OUTLETS_CONFIDENCE_THRESHOLD})`)
  } else if (signals.outlets.value === 'abundant' || signals.outlets.value === 'some') {
    updates.has_outlets = true
    notes.push(`has_outlets: write true (outlets=${signals.outlets.value}, confidence=${signals.outlets.confidence})`)
  } else {
    // value is 'rare' or 'none' — never write false, per the safety rule above.
    notes.push(`has_outlets: skip (signal says "${signals.outlets.value}" — never writing false over a default)`)
  }

  // ── laptop_friendly: only ever promote to true ──
  if (current.laptop_friendly) {
    notes.push('laptop_friendly: skip (already true, not touching)')
  } else if (signals.laptop_culture.value === 'unknown') {
    notes.push('laptop_friendly: skip (signal unknown)')
  } else if (signals.laptop_culture.confidence < LAPTOP_CONFIDENCE_THRESHOLD) {
    notes.push(
      `laptop_friendly: skip (confidence ${signals.laptop_culture.confidence} < ${LAPTOP_CONFIDENCE_THRESHOLD})`
    )
  } else if (signals.laptop_culture.value === 'encouraged' || signals.laptop_culture.value === 'tolerated') {
    updates.laptop_friendly = true
    notes.push(
      `laptop_friendly: write true (laptop_culture=${signals.laptop_culture.value}, confidence=${signals.laptop_culture.confidence})`
    )
  } else {
    notes.push(`laptop_friendly: skip (signal says "${signals.laptop_culture.value}" — never writing false over a default)`)
  }

  // ── noise_level: nullable, NULL is a real "unset" sentinel ──
  if (current.noise_level !== null) {
    notes.push(`noise_level: skip (already set to "${current.noise_level}")`)
  } else if (signals.noise_baseline.value === 'unknown') {
    notes.push('noise_level: skip (signal unknown)')
  } else if (signals.noise_baseline.confidence < NOISE_CONFIDENCE_THRESHOLD) {
    notes.push(
      `noise_level: skip (confidence ${signals.noise_baseline.confidence} < ${NOISE_CONFIDENCE_THRESHOLD})`
    )
  } else {
    updates.noise_level = signals.noise_baseline.value
    notes.push(`noise_level: write "${signals.noise_baseline.value}" (confidence=${signals.noise_baseline.confidence})`)
  }

  // ── vibe_tags: only fill when currently empty; no per-item confidence
  // on this field (see EnrichmentOutput.vibe_signals doc), so gate on the
  // column being at its default rather than a numeric threshold. ──
  if (current.vibe_tags.length > 0) {
    notes.push(`vibe_tags: skip (already has ${current.vibe_tags.length} tag(s))`)
  } else {
    const cleaned = Array.from(
      new Set(signals.vibe_signals.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0))
    ).slice(0, VIBE_TAG_MAX)
    if (cleaned.length > 0) {
      updates.vibe_tags = cleaned
      notes.push(`vibe_tags: write [${cleaned.join(', ')}]`)
    } else {
      notes.push('vibe_tags: skip (model returned no tags)')
    }
  }

  return { updates, notes }
}

// ── Staleness / eligibility gate ──────────────────────────────

export const STALENESS_DAYS = 90

export function isTrivialNotes(notes: string | null | undefined): boolean {
  if (!notes) return true
  return notes.trim().length < 10 // a handful of chars isn't mineable text
}

export function isStale(enrichedAt: string | null, force: boolean, now: Date = new Date()): boolean {
  if (force) return true
  if (!enrichedAt) return true
  const cutoff = now.getTime() - STALENESS_DAYS * 24 * 60 * 60 * 1000
  return new Date(enrichedAt).getTime() < cutoff
}
