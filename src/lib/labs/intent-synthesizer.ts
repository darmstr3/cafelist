// ─────────────────────────────────────────────────────────────
// Intent synthesizer — turns a structured V2 picker payload
// ({ mode, modifiers, location, weekday }) into a ParsedIntent
// the existing retriever + fit-scorer already understand.
//
// Two reasons this exists as a separate module from intent-parser:
//   1. It is pure and deterministic — no LLM call, no network.
//      Unit-testable in isolation, no cost.
//   2. It keeps `route.ts` thin: the route decides which path to
//      take (V1 free-text → parseIntent vs. V2 picker →
//      synthesizeIntent), and the heavy synthesis logic lives here.
//
// Folding rules (locked here so every future mode/modifier author
// gets the same behavior):
//
//   - Modifier `hardConstraints`:
//       scalar fields  → modifier overrides mode on overlap
//       array fields   → modifier value is UNIONed with mode's
//                        and de-duplicated
//     Matches the JSDoc on `Modifier` in modes.ts.
//
//   - Modifier `weightDeltas`:
//       added to mode's per-component weight, clamped to [0, 3].
//
//   - Component weight → Priority:
//       3 → 'must'    2 → 'should'    1 → 'nice'    0 → omit
//
//   - `priorities` map:
//       only includes keys for ParsedIntent fields that have a
//       non-null / non-empty value. Mirrors the convention in the
//       intent-parser system prompt ("only include fields the user
//       actually expressed"), so retriever/scorer behave the same
//       whether the intent came from text or from the picker.
//
// See: DECISION_LOG ADR-0001 (mode picker), ADR-0002 (deterministic
// recs, LLM explains), and modes.ts for the registries.
// ─────────────────────────────────────────────────────────────

import {
  MODES,
  MODIFIERS,
  type ComponentKey,
  type HardConstraints,
  type ModeId,
  type ModifierId,
  type WeightLevel,
} from './modes'
import type { ParsedIntent, Priority } from './types'

export interface PickerLocation {
  city?: string | null
  neighborhood?: string | null
}

export interface SynthesizeArgs {
  mode: ModeId
  modifiers: ModifierId[]
  location: PickerLocation | null
  /** Day of week, e.g. "saturday". The picker collects this; the
   *  retriever/scorer don't consume it yet (see ParsedIntent.weekday
   *  comment) — it rides along for logging + future use. */
  weekday: string | null
}

/**
 * Build a ParsedIntent from a V2 picker payload.
 *
 * Callers should NOT pass `mode === 'other'` — the route routes
 * Other through the existing intent-parser instead. If it does come
 * through here, the resulting intent is near-empty (Other's mode
 * entry has inert constraints by design), which is harmless but
 * useless; the route is responsible for the branch.
 */
export function synthesizeIntent(args: SynthesizeArgs): ParsedIntent {
  const modeDef = MODES[args.mode]

  // 1. Start from the mode's declared constraints + weights.
  let constraints: HardConstraints = { ...modeDef.hardConstraints }
  const weights: Record<ComponentKey, number> = { ...modeDef.weights }

  // 2. Fold each modifier in declared order. Modifier order matters
  //    for scalar fields (last writer wins) but not for arrays
  //    (union is commutative). Picker UI presents pills in a stable
  //    order, so this is deterministic from the user's perspective.
  for (const modId of args.modifiers) {
    const mod = MODIFIERS[modId]
    if (!mod) continue // defensive — route validates IDs upstream

    if (mod.hardConstraints) {
      constraints = foldConstraints(constraints, mod.hardConstraints)
    }
    if (mod.weightDeltas) {
      for (const key of Object.keys(mod.weightDeltas) as ComponentKey[]) {
        const delta = mod.weightDeltas[key] ?? 0
        weights[key] = clamp(weights[key] + delta, 0, 3)
      }
    }
  }

  // 3. Map per-component weights to Priority values.
  const locPrio = weightToPriority(weights.location)
  const timePrio = weightToPriority(weights.time)
  const noisePrio = weightToPriority(weights.noise)
  const featPrio = weightToPriority(weights.features)
  const vibePrio = weightToPriority(weights.vibe)

  // 4. Resolve geo from the picker. `transit` isn't supplied by the
  //    picker today — leave it empty; if a user typed a station in
  //    the optional query field, the merge step in the route picks
  //    it up via parseIntent().
  const city = args.location?.city ?? null
  const neighborhood = args.location?.neighborhood ?? null

  // 5. Build the priorities map. Only set a priority for a field
  //    that actually has a value, AND only when the component's
  //    weight is non-zero. This prevents the scorer from being
  //    asked to weight a constraint nobody expressed.
  const priorities: ParsedIntent['priorities'] = {}
  if (city && locPrio) priorities.city = locPrio
  if (neighborhood && locPrio) priorities.neighborhood = locPrio
  if (constraints.timeOfDay && timePrio) priorities.timeOfDay = timePrio
  if (args.weekday && timePrio) priorities.weekday = timePrio
  if (constraints.noiseTolerance && noisePrio) priorities.noiseTolerance = noisePrio
  if (constraints.needsOutlets != null && featPrio) priorities.needsOutlets = featPrio
  if (constraints.needsWifi != null && featPrio) priorities.needsWifi = featPrio
  if (constraints.laptopFriendly != null && featPrio) priorities.laptopFriendly = featPrio
  if (constraints.needsFood != null && featPrio) priorities.needsFood = featPrio
  if (constraints.vibe && constraints.vibe.length > 0 && vibePrio) {
    priorities.vibe = vibePrio
  }

  return {
    // The recommender prompt reads rawQuery as "what the user
    // articulated." The mode's exampleQuery is hand-tuned for
    // exactly this purpose — see Mode.exampleQuery JSDoc.
    rawQuery: modeDef.exampleQuery,

    city,
    neighborhood,
    transit: [],

    timeOfDay: constraints.timeOfDay ?? null,
    startTimeIso: null,
    durationMinutes: null,
    weekday: args.weekday ?? null,

    noiseTolerance: constraints.noiseTolerance ?? null,
    vibe: dedupe(constraints.vibe ?? []),

    needsOutlets: constraints.needsOutlets ?? null,
    needsWifi: constraints.needsWifi ?? null,
    laptopFriendly: constraints.laptopFriendly ?? null,
    needsFood: constraints.needsFood ?? null,

    avoid: dedupe(constraints.avoid ?? []),

    preferredTypes: dedupe(constraints.preferredTypes ?? []),

    priorities,
  }
}

/**
 * Overlay a parsed-from-text intent on top of a synthesized intent.
 *
 * Used when `mode !== 'other'` AND the user also typed text into the
 * optional `query?` field. We parse that text (via parseIntent), then
 * merge it OVER the synthesized intent here.
 *
 * Rules:
 *   - Scalars: parsed value wins when non-null. Picker is a default;
 *     explicit text is more specific.
 *   - Arrays: union + dedupe.
 *   - priorities: parsed wins per-key (text-stated priority beats
 *     picker-implied priority).
 *   - rawQuery: concatenate so the recommender sees both signals.
 */
export function mergeParsedOverSynth(
  synth: ParsedIntent,
  parsed: ParsedIntent
): ParsedIntent {
  return {
    rawQuery: `${synth.rawQuery}\n\nAdditional notes: ${parsed.rawQuery}`.trim(),
    city: parsed.city ?? synth.city,
    neighborhood: parsed.neighborhood ?? synth.neighborhood,
    transit: dedupe([...synth.transit, ...parsed.transit]),
    timeOfDay: parsed.timeOfDay ?? synth.timeOfDay,
    startTimeIso: parsed.startTimeIso ?? synth.startTimeIso,
    durationMinutes: parsed.durationMinutes ?? synth.durationMinutes,
    weekday: parsed.weekday ?? synth.weekday,
    noiseTolerance: parsed.noiseTolerance ?? synth.noiseTolerance,
    vibe: dedupe([...synth.vibe, ...parsed.vibe]),
    needsOutlets: parsed.needsOutlets ?? synth.needsOutlets,
    needsWifi: parsed.needsWifi ?? synth.needsWifi,
    laptopFriendly: parsed.laptopFriendly ?? synth.laptopFriendly,
    needsFood: parsed.needsFood ?? synth.needsFood,
    avoid: dedupe([...synth.avoid, ...parsed.avoid]),
    preferredTypes: dedupe([...synth.preferredTypes, ...parsed.preferredTypes]),
    priorities: { ...synth.priorities, ...parsed.priorities },
  }
}

// ── Internal helpers ─────────────────────────────────────────

function foldConstraints(
  base: HardConstraints,
  overlay: HardConstraints
): HardConstraints {
  return {
    // Scalars: overlay wins when defined.
    noiseTolerance: overlay.noiseTolerance ?? base.noiseTolerance,
    needsOutlets: overlay.needsOutlets ?? base.needsOutlets,
    needsWifi: overlay.needsWifi ?? base.needsWifi,
    laptopFriendly: overlay.laptopFriendly ?? base.laptopFriendly,
    needsFood: overlay.needsFood ?? base.needsFood,
    openAfter: overlay.openAfter ?? base.openAfter,
    timeOfDay: overlay.timeOfDay ?? base.timeOfDay,
    // Arrays: union + dedupe. See Modifier JSDoc in modes.ts.
    vibe: dedupe([...(base.vibe ?? []), ...(overlay.vibe ?? [])]),
    avoid: dedupe([...(base.avoid ?? []), ...(overlay.avoid ?? [])]),
    preferredTypes: dedupe([
      ...(base.preferredTypes ?? []),
      ...(overlay.preferredTypes ?? []),
    ]),
  }
}

function weightToPriority(w: WeightLevel | number): Priority | null {
  // Defensive: callers pass weights already clamped to [0,3], but
  // accept `number` for ergonomics. A weight of 0 means "ignore" —
  // we return null and the caller omits the priority entry.
  if (w >= 3) return 'must'
  if (w === 2) return 'should'
  if (w === 1) return 'nice'
  return null
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function dedupe<T>(xs: T[]): T[] {
  return Array.from(new Set(xs))
}

// ── Runtime ID guards ────────────────────────────────────────
// TS unions don't survive to runtime, so the route uses these to
// validate the picker payload before handing off to synthesizeIntent.

const KNOWN_MODE_IDS: ReadonlySet<string> = new Set(Object.keys(MODES))
const KNOWN_MODIFIER_IDS: ReadonlySet<string> = new Set(Object.keys(MODIFIERS))

export function isModeId(value: unknown): value is ModeId {
  return typeof value === 'string' && KNOWN_MODE_IDS.has(value)
}

export function isModifierId(value: unknown): value is ModifierId {
  return typeof value === 'string' && KNOWN_MODIFIER_IDS.has(value)
}
