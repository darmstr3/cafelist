// ─────────────────────────────────────────────────────────────
// Cafelist /labs V2 — mode + modifier registry.
//
// Single source of truth for the mode picker. Two exports:
//   - MODES:     the 4 primary modes + Other / describe.
//   - MODIFIERS: the toggle pills layered on a chosen mode.
//
// This module is DATA ONLY — no UI imports, no scoring logic, no
// runtime side effects. The picker UI iterates Object.values(MODES)
// to render cards and Object.values(MODIFIERS) to render pills; the
// /api/labs/recommend route (ticket #7) reads the same data to
// synthesize a ParsedIntent that the existing retriever +
// fit-scorer already understand.
//
// Why declarative: per ADR-0002, recommendations are deterministic
// and the LLM only explains. Keeping mode→constraint mapping as
// inert data means a single eval case pins each mode's behaviour
// and every future tweak is auditable in git-diff form. Per ticket
// #6, removing a mode card or a modifier pill is a 1-line UI
// change because nothing else depends on them existing.
//
// See:
//   - DECISION_LOG.md ADR-0001 (4 + Other + modifier picker design)
//   - DECISION_LOG.md ADR-0002 (deterministic recs, LLM explains)
//   - LABS_V2_PLAN.md §2, §8 (MVP scope, ticket #6)
//   - fit-scorer.ts             (component vocabulary, Priority weights)
//   - types.ts                  (ParsedIntent shape the synthesizer fills)
// ─────────────────────────────────────────────────────────────

import type { NoiseLevel, SpotType } from '@/types'

// ── ID unions ────────────────────────────────────────────────
// Adding a new mode/modifier: extend the union, then add the entry
// to MODES/MODIFIERS. TypeScript's exhaustive Record check refuses
// to compile until the entry exists.

export type ModeId =
  | 'deep_work'
  | 'study_session'
  | 'creative_reset'
  | 'coffee_date'
  | 'client_meeting'
  | 'other'

// NOTE: `founder_energy` is intentionally absent from MVP. ADR-0001
// lists it as a modifier pill, but it requires Curator/Scout vibe
// tags ('community', 'founder', 'coworking', 'collaborative') that
// don't reliably exist in the data yet. Shipping it would silently
// no-op for most queries and break the modifier-composes-with-mode
// contract from a user perspective. Coverage-Gap is the right path
// to surface real demand and justify adding the tag vocabulary;
// ADR-0001 will be amended in the follow-up PR when we add it back.
export type ModifierId =
  | 'open_late'
  | 'quiet_to_read'

// ── Component vocabulary ─────────────────────────────────────
// Mirrors the five component scorers in fit-scorer.ts. If a new
// component scorer lands, add it here in the same PR so modes can
// weight it.

export type ComponentKey = 'location' | 'time' | 'noise' | 'features' | 'vibe'

// ── Weight scale ─────────────────────────────────────────────
// Aligned to fit-scorer's Priority weights (nice=1, should=2,
// must=3). 0 = ignore.
//
// The /api/labs/recommend synthesizer (ticket #7) maps each
// component weight onto the ParsedIntent priority of the
// corresponding field(s):
//   3 → 'must'    2 → 'should'    1 → 'nice'    0 → omit
//
// Using numbers instead of the Priority strings leaves room for
// finer-grained weighting later without breaking the data shape.

export type WeightLevel = 0 | 1 | 2 | 3

// ── Hard constraints ─────────────────────────────────────────
// Field-level constraints a mode (or modifier) implies. The
// synthesizer folds these directly into a ParsedIntent; undefined
// means "no opinion" (i.e. null in intent space). Keep this shape
// in sync with ParsedIntent — if a new intent field becomes
// filterable, add it here so modes can declare it.

export interface HardConstraints {
  noiseTolerance?: NoiseLevel
  needsOutlets?: boolean
  needsWifi?: boolean
  laptopFriendly?: boolean
  needsFood?: boolean
  vibe?: string[]
  avoid?: string[]
  preferredTypes?: SpotType[]
  /** HH:MM 24-hour. Used by the `open_late` modifier. The
   *  synthesizer also sets timeOfDay to a phrase the fit-scorer's
   *  late-night regex picks up ("after 9pm"). Once retriever.ts
   *  grows a real open-after filter, it consumes this field. */
  openAfter?: string
  /** Free-text phrasing fed to ParsedIntent.timeOfDay so the
   *  existing fit-scorer time component activates without a
   *  scorer change. e.g. "after 9pm". */
  timeOfDay?: string
}

// ── Mode + Modifier shapes ───────────────────────────────────

export interface Mode {
  id: ModeId
  /** UI label on the picker card. */
  label: string
  /** One-line description under the label. Plain language — read
   *  by users on the picker, not by the LLM. */
  blurb: string
  /** Constraints this mode implies. */
  hardConstraints: HardConstraints
  /** Per-component weighting. See WeightLevel. */
  weights: Record<ComponentKey, WeightLevel>
  /** Free-text equivalent of the mode. Two uses:
   *   - placeholder copy in the "describe what you need" field
   *   - fed to the recommender prompt as the user's articulated
   *     goal so the "why this fits" sentence reads fluently. */
  exampleQuery: string
}

export interface Modifier {
  id: ModifierId
  label: string
  /** Constraints layered on the chosen mode's. The synthesizer folds
   *  these with an asymmetric rule:
   *   - Scalar fields (noiseTolerance, openAfter, timeOfDay, the
   *     boolean needsX flags) — modifier OVERRIDES mode on overlap.
   *   - Array fields (vibe, avoid, preferredTypes) — modifier value
   *     is UNIONed with mode's and de-duplicated (case-sensitive).
   *
   *  Rationale: a modifier like "Quiet enough to read" should ADD a
   *  vibe constraint, not erase the mode's atmospheric defaults. None
   *  of today's modifiers redefine arrays, so this docstring exists
   *  to lock the rule in before someone authors one that does.
   *  See src/lib/labs/intent-synthesizer.ts. */
  hardConstraints?: HardConstraints
  /** Per-component weight bumps. The synthesizer clamps the
   *  resulting weight to 0..3. */
  weightDeltas?: Partial<Record<ComponentKey, number>>
}

// ── MODES ────────────────────────────────────────────────────
//
// Acceptance criterion (ticket #6): removing a mode here removes
// it from the picker without further changes — the UI iterates
// over Object.values(MODES). Tests in ticket #11 will assert this
// registry is well-formed (no empty labels, weights in range,
// hardConstraints reference only known intent fields).

export const MODES: Record<ModeId, Mode> = {
  deep_work: {
    id: 'deep_work',
    label: 'Deep Work',
    blurb: 'Heads-down stretch with outlets, wifi, and quiet to focus.',
    hardConstraints: {
      noiseTolerance: 'quiet',
      needsOutlets: true,
      needsWifi: true,
      laptopFriendly: true,
    },
    weights: { location: 2, time: 2, noise: 3, features: 3, vibe: 1 },
    exampleQuery:
      'Quiet spot with outlets and wifi where I can post up with my laptop for a few hours.',
  },

  // TODO(data-agent, ticket #6): Tune Study session's hardConstraints
  // and weights once Coverage-Gap surfaces student-query patterns.
  // UX defaults below assume: quieter than deep_work, table space
  // matters more than wifi speed, longer dwell times tolerated.
  // The label/blurb/exampleQuery are UX-locked; the constraints
  // vector is Data-Agent territory.
  study_session: {
    id: 'study_session',
    label: 'Study session',
    blurb: 'Long stretch with textbooks or notes — quiet, outlets, table space.',
    hardConstraints: {
      noiseTolerance: 'quiet',
      needsOutlets: true,
      needsWifi: true,
      laptopFriendly: true,
      vibe: ['cozy', 'calm'],
    },
    weights: { location: 2, time: 2, noise: 3, features: 3, vibe: 2 },
    exampleQuery:
      'Quiet spot to study for a few hours — outlets, room for textbooks and a laptop, not too crowded.',
  },

  creative_reset: {
    id: 'creative_reset',
    label: 'Creative Reset',
    blurb: 'Somewhere atmospheric to think, sketch, or read — not a desk setup.',
    hardConstraints: {
      noiseTolerance: 'moderate',
      vibe: ['cozy', 'creative', 'inspiring'],
    },
    weights: { location: 2, time: 1, noise: 2, features: 1, vibe: 3 },
    exampleQuery:
      'Cozy, atmospheric cafe to recharge — pour-over, a notebook, no laptop necessary.',
  },

  coffee_date: {
    id: 'coffee_date',
    label: 'Coffee Date / Social',
    blurb: 'Easygoing spot to meet someone — conversation-friendly.',
    hardConstraints: {
      noiseTolerance: 'moderate',
      vibe: ['cozy', 'warm'],
      avoid: ['library', 'silent'],
    },
    weights: { location: 3, time: 2, noise: 2, features: 1, vibe: 3 },
    exampleQuery:
      'Somewhere nice to meet a friend for coffee — easy to talk, good atmosphere.',
  },

  client_meeting: {
    id: 'client_meeting',
    label: 'Client Meeting',
    blurb: 'Professional, quiet enough to talk, with reliable wifi.',
    hardConstraints: {
      noiseTolerance: 'quiet',
      needsWifi: true,
      vibe: ['professional', 'calm'],
    },
    weights: { location: 3, time: 2, noise: 3, features: 3, vibe: 2 },
    exampleQuery:
      'Professional spot to meet a client — quiet enough to talk and present, reliable wifi.',
  },

  // "Other" is the free-text escape hatch. /api/labs/recommend
  // detects mode === 'other' and routes the request through the
  // existing intent-parser instead of synthesizing from this entry.
  // Constraints/weights here are intentionally inert; this row
  // exists so the picker UI can render an Other card uniformly.
  other: {
    id: 'other',
    label: 'Other / describe what you need',
    blurb: 'Tell us in your own words and we’ll match accordingly.',
    hardConstraints: {},
    weights: { location: 1, time: 1, noise: 1, features: 1, vibe: 1 },
    exampleQuery: '',
  },
}

// ── MODIFIERS ────────────────────────────────────────────────
//
// Pills shown after a mode is picked. Multi-select. Each pill is a
// minimal delta — a hard constraint to fold in, or a weight bump
// on an existing component. Per ADR-0001, the modifier set is
// deliberately small; adding a third pill is a real design call,
// not a "while I'm here" change. (`founder_energy` from ADR-0001
// is deferred — see the ModifierId comment above.)

export const MODIFIERS: Record<ModifierId, Modifier> = {
  open_late: {
    id: 'open_late',
    label: 'Open late',
    hardConstraints: {
      openAfter: '21:00',
      // Mirror as a timeOfDay phrase so fit-scorer's existing
      // late-night regex (/late|after\s*(6|7|8|9|10|11)\s*pm.../)
      // activates today without a scorer change.
      timeOfDay: 'after 9pm',
    },
    weightDeltas: { time: 1 },
  },

  quiet_to_read: {
    id: 'quiet_to_read',
    label: 'Quiet enough to read',
    hardConstraints: { noiseTolerance: 'quiet' },
    weightDeltas: { noise: 1 },
  },
}
