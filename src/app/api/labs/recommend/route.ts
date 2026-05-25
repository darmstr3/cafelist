// ─────────────────────────────────────────────────────────────
// POST /api/labs/recommend
//
// Orchestrator for the /labs agentic discovery layer. Wires the
// pipeline together:
//
//   parse / synthesize intent → retrieve candidates → score fit
//        → write recommendation → evaluate result
//
// Each stage is wrapped in a tracer span so the response includes a
// full per-stage trace (latency, token usage, estimated cost, OK
// or error) for the UI to render in expandable panels.
//
// Two request shapes, dispatched by payload:
//
//   V1 (free text, today's /labs):
//     { query: string }
//     → parseIntent(query) inside the intent_parser tracer span.
//
//   V2 (mode picker, ticket #7):
//     { mode, modifiers, location, weekday, query? | modeFreeform? }
//     → synthesizeIntent({ mode, modifiers, location, weekday })
//       inside the intent_parser tracer span. If `mode === 'other'`,
//       falls back to parseIntent(query). If `mode !== 'other'` and
//       a non-empty `query` is also supplied, parseIntent runs on
//       that text and is merged over the synthesized intent.
//
//     Field aliases (the ModePicker UI emits one shape, scripts/curl
//     callers prefer the other; we accept both for the same field):
//       - `location` may be a string ("Williamsburg"), an object
//         ({ city?, neighborhood? }), or null. A bare string is
//         treated as neighborhood.
//       - `modeFreeform` is an alias for `query`. The picker's
//         "Anything else?" / "Tell us what you need" textarea binds
//         to `modeFreeform`; either field is accepted.
//
// V2 is gated server-side behind isLabsV2Enabled() — the picker UI
// is already flag-gated, but this prevents a stray curl from
// exercising the V2 path on a production deploy where the flag is
// off. The flip from V2-off to V2-on in prod is a Vercel env-var
// change, not a code change (ADR-0004).
//
// The route is intentionally isolated from the rest of the app —
// it doesn't touch any other API surface, and its only shared
// dependency is `getSpots()` from /lib/spots (read-only).
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { parseIntent } from '@/lib/labs/intent-parser'
import { retrieveCafes } from '@/lib/labs/retriever'
import { scoreCandidates } from '@/lib/labs/fit-scorer'
import { writeRecommendation } from '@/lib/labs/recommender'
import { evaluate } from '@/lib/labs/evaluator'
import { Tracer } from '@/lib/labs/trace'
import { logAgentRun } from '@/lib/labs/query-logger'
import { isLabsV2Enabled } from '@/lib/labs/feature-flags'
import { MODES, type ModifierId } from '@/lib/labs/modes'
import {
  isModeId,
  isModifierId,
  mergeParsedOverSynth,
  synthesizeIntent,
  type PickerLocation,
} from '@/lib/labs/intent-synthesizer'
import type { AgentRun, ParsedIntent, Recommendation, RetrievalResult } from '@/lib/labs/types'

export const runtime = 'nodejs'

const MAX_QUERY_LEN = 500

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Dispatch on payload shape. V2 = picker = a string `mode` field.
  // V1 = legacy = a string `query` field with no `mode`.
  if (typeof body.mode === 'string') {
    return handleV2(body)
  }
  return handleV1(body)
}

// ── V1 free-text path ────────────────────────────────────────
// Unchanged contract from /labs today. Kept in its own function so
// the V1 and V2 branches stay legible side-by-side.

async function handleV1(body: Record<string, unknown>): Promise<NextResponse> {
  const query = typeof body.query === 'string' ? body.query.trim() : ''
  if (!query) {
    return NextResponse.json({ error: 'Missing "query" string' }, { status: 400 })
  }
  if (query.length > MAX_QUERY_LEN) {
    return NextResponse.json(
      { error: `Query exceeds ${MAX_QUERY_LEN} characters` },
      { status: 400 }
    )
  }

  const tracer = new Tracer()

  let intent: ParsedIntent
  try {
    intent = await tracer.span('intent_parser', async (ctx) => {
      const { intent: parsed, usage } = await parseIntent(query)
      ctx.setLlmUsage(usage)
      return parsed
    })
  } catch (err) {
    return finalizeFatal(tracer, query, null, err)
  }

  return executePipeline({ intent, queryStr: query, tracer })
}

// ── V2 picker path ───────────────────────────────────────────

async function handleV2(body: Record<string, unknown>): Promise<NextResponse> {
  // Defense-in-depth: the UI is already flag-gated, but block the
  // V2 payload server-side so a misconfigured deploy or a stray
  // curl can't exercise the V2 branch when the flag is off.
  if (!isLabsV2Enabled()) {
    return NextResponse.json(
      { error: 'Labs V2 is not enabled in this environment' },
      { status: 400 }
    )
  }

  // ── Validate payload ──────────────────────────────────────
  if (!isModeId(body.mode)) {
    return NextResponse.json(
      { error: 'Invalid "mode" — expected one of the registered ModeIds' },
      { status: 400 }
    )
  }
  const mode = body.mode

  if (!Array.isArray(body.modifiers) || !body.modifiers.every(isModifierId)) {
    return NextResponse.json(
      { error: 'Invalid "modifiers" — expected an array of registered ModifierIds' },
      { status: 400 }
    )
  }
  const modifiers = body.modifiers as ModifierId[]

  const locationResult = parseLocation(body.location)
  if (locationResult === 'invalid') {
    return NextResponse.json(
      {
        error:
          'Invalid "location" — expected null, a string (treated as neighborhood), or { city?: string, neighborhood?: string }',
      },
      { status: 400 }
    )
  }
  const location = locationResult

  if (body.weekday != null && typeof body.weekday !== 'string') {
    return NextResponse.json(
      { error: 'Invalid "weekday" — expected string or null' },
      { status: 400 }
    )
  }
  const weekday = (body.weekday as string | undefined) ?? null

  // Accept both `query` (script/curl callers) and `modeFreeform`
  // (the ModePicker UI field). Treat as aliases — pick whichever is
  // present, prefer `query` if both somehow arrive. Empty strings on
  // either field collapse to "no text", which is fine for non-Other
  // modes and a 400 for Other.
  const queryRaw =
    typeof body.query === 'string'
      ? body.query
      : typeof body.modeFreeform === 'string'
        ? body.modeFreeform
        : ''
  const queryText = queryRaw.trim()
  if (mode === 'other' && !queryText) {
    return NextResponse.json(
      {
        error:
          'Mode "other" requires a non-empty "query" (or "modeFreeform") string',
      },
      { status: 400 }
    )
  }
  if (queryText.length > MAX_QUERY_LEN) {
    return NextResponse.json(
      { error: `Query exceeds ${MAX_QUERY_LEN} characters` },
      { status: 400 }
    )
  }

  // ── Resolve intent ────────────────────────────────────────
  const tracer = new Tracer()
  let intent: ParsedIntent

  if (mode === 'other') {
    // Pure free-text — same as V1, just nested under the V2 branch
    // so the gating + validation rules above still apply.
    try {
      intent = await tracer.span('intent_parser', async (ctx) => {
        const { intent: parsed, usage } = await parseIntent(queryText)
        ctx.setLlmUsage(usage)
        return parsed
      })
    } catch (err) {
      return finalizeFatal(tracer, queryText, null, err)
    }
  } else {
    // Synthesize from picker payload. The span emits an
    // `intent_parser` event with no `llm` field attached when the
    // user did not also type text — that's the signal to the trace
    // UI and /labs/eval that this intent came from the picker.
    try {
      intent = await tracer.span('intent_parser', async (ctx) => {
        const synth = synthesizeIntent({ mode, modifiers, location, weekday })
        if (!queryText) return synth

        // User picked a mode AND typed text. Parse the text and
        // overlay it on the synthesized base — parsed scalars win,
        // arrays union, parsed priorities override. The extra parse
        // costs one Claude call (same as V1) and surfaces real
        // signal the user gave us (e.g. "near the F train").
        const { intent: parsed, usage } = await parseIntent(queryText)
        ctx.setLlmUsage(usage)
        return mergeParsedOverSynth(synth, parsed)
      })
    } catch (err) {
      return finalizeFatal(tracer, queryText || MODES[mode].exampleQuery, null, err)
    }
  }

  // Use the user's typed text for the run's `query` field when present;
  // otherwise fall back to the mode's exampleQuery so logs and the
  // trace UI have something human-readable to display.
  const queryForLog = queryText || MODES[mode].exampleQuery
  return executePipeline({ intent, queryStr: queryForLog, tracer })
}

// ── Shared post-intent pipeline ──────────────────────────────
// Everything after the intent is resolved is identical between V1
// and V2: retrieve → score → recommend → evaluate → finalize.

async function executePipeline({
  intent,
  queryStr,
  tracer,
}: {
  intent: ParsedIntent
  queryStr: string
  tracer: Tracer
}): Promise<NextResponse> {
  let recommendation: Recommendation | null = null
  let evaluation: AgentRun['evaluation'] = null

  try {
    const retrieval: RetrievalResult = await tracer.span('retriever', async () => {
      return retrieveCafes(intent)
    })

    if (retrieval.candidates.length === 0) {
      // Bail with a still-useful trace.
      const run = tracer.finalize({
        query: queryStr,
        recommendation: null,
        evaluation: null,
        fatal: { message: 'No candidate cafes found' },
      })
      void logAgentRun({ run, intent })
      return NextResponse.json(run, { status: 200 })
    }

    const scored = await tracer.span('fit_scorer', async () => {
      return scoreCandidates(intent, retrieval.candidates)
    })

    recommendation = await tracer.span('recommender', async (ctx) => {
      const { recommendation, usage } = await writeRecommendation({
        intent,
        scored,
        spots: retrieval.candidates,
      })
      ctx.setLlmUsage(usage)
      // Attach (1) the URL slug, and (2) a Google Maps search query
      // to each pick. The LLM doesn't emit either — it only emits
      // spotId/spotName. The route looks both up from the retrieved
      // spots after the fact. The card uses gmapsQuery to open Google
      // Maps directly: users asking "find me a café" want directions,
      // not an in-app detail screen.
      const spotById = new Map(retrieval.candidates.map((s) => [s.id, s]))
      const mapQueryFor = (id: string): string | undefined => {
        const spot = spotById.get(id)
        if (!spot) return undefined
        // Address is the most disambiguating — Google Maps will resolve
        // "{name}, {address}" to the right pin nearly every time. Fall
        // back to name + neighborhood + city when address is missing.
        if (spot.address) return `${spot.spotName ?? spot.name}, ${spot.address}`
        const locality = spot.neighborhood ?? spot.city
        return locality ? `${spot.name} ${locality}` : spot.name
      }
      recommendation.picks = recommendation.picks.map((p) => ({
        ...p,
        slug: spotById.get(p.spotId)?.slug,
        gmapsQuery: mapQueryFor(p.spotId),
      }))
      if (recommendation.backup) {
        recommendation.backup = {
          ...recommendation.backup,
          slug: spotById.get(recommendation.backup.spotId)?.slug,
          gmapsQuery: mapQueryFor(recommendation.backup.spotId),
        }
      }
      return recommendation
    })

    evaluation = await tracer.span('evaluator', async (ctx) => {
      const { evaluation, usage } = await evaluate({
        originalQuery: queryStr,
        intent,
        recommendation: recommendation!,
      })
      ctx.setLlmUsage(usage)
      return evaluation
    })

    const run = tracer.finalize({ query: queryStr, recommendation, evaluation })
    void logAgentRun({ run, intent })
    return NextResponse.json(run, { status: 200 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const run = tracer.finalize({
      query: queryStr,
      recommendation,
      evaluation,
      fatal: { message },
    })
    void logAgentRun({ run, intent })
    // 200 + fatal flag so the client can still render the partial
    // trace for debugging — alternative (500) hides observability
    // data behind a generic error toast.
    return NextResponse.json(run, { status: 200 })
  }
}

// ── Helpers ──────────────────────────────────────────────────

function finalizeFatal(
  tracer: Tracer,
  queryStr: string,
  intentForLog: ParsedIntent | null,
  err: unknown
): NextResponse {
  const message = err instanceof Error ? err.message : String(err)
  const run = tracer.finalize({
    query: queryStr,
    recommendation: null,
    evaluation: null,
    fatal: { message },
  })
  void logAgentRun({ run, intent: intentForLog })
  return NextResponse.json(run, { status: 200 })
}

/**
 * Validate the `location` field of a V2 picker payload.
 *
 * Accepts three shapes:
 *   - null / undefined  → user didn't supply one
 *   - string            → bare neighborhood (matches ModePicker's
 *                         current `location: string` field)
 *   - { city?, neighborhood? } → structured form (script/curl callers,
 *                         and any future picker upgrade that splits
 *                         city from neighborhood)
 *
 * Returns:
 *   - PickerLocation when valid (or null if all fields are blank)
 *   - null when the input was null/undefined
 *   - 'invalid' when present but malformed (caller should 400)
 *
 * Empty strings inside the object are normalized to null so a blank
 * picker field doesn't filter the retriever to `city == ''` → zero
 * candidates.
 */
function parseLocation(value: unknown): PickerLocation | null | 'invalid' {
  if (value == null) return null

  // Bare string from the picker UI: treat as neighborhood. We don't
  // try to split "Williamsburg, Brooklyn" into city/neighborhood
  // here — the retriever already matches loosely on either field,
  // and the parser would just be guessing.
  if (typeof value === 'string') {
    const s = value.trim()
    if (!s) return null
    return { city: null, neighborhood: s }
  }

  if (typeof value !== 'object') return 'invalid'
  const obj = value as Record<string, unknown>
  const city = obj.city
  const neighborhood = obj.neighborhood
  if (city != null && typeof city !== 'string') return 'invalid'
  if (neighborhood != null && typeof neighborhood !== 'string') return 'invalid'
  const cityStr = typeof city === 'string' ? city.trim() : ''
  const nhoodStr = typeof neighborhood === 'string' ? neighborhood.trim() : ''
  if (!cityStr && !nhoodStr) return null
  return {
    city: cityStr || null,
    neighborhood: nhoodStr || null,
  }
}
