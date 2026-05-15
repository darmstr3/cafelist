// ─────────────────────────────────────────────────────────────
// POST /api/labs/recommend
//
// Orchestrator for the /labs agentic discovery layer. Wires the
// pipeline together:
//
//   parse intent → retrieve candidates → score fit
//        → write recommendation → evaluate result
//
// Each stage is wrapped in a tracer span so the response includes a
// full per-stage trace (latency, token usage, estimated cost, OK
// or error) for the UI to render in expandable panels.
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
import type { AgentRun, ParsedIntent, Recommendation, RetrievalResult } from '@/lib/labs/types'

export const runtime = 'nodejs'

const MAX_QUERY_LEN = 500

export async function POST(req: NextRequest) {
  let body: { query?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
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

  let recommendation: Recommendation | null = null
  let evaluation: AgentRun['evaluation'] = null
  // Hoisted so the logger can still record the parsed intent even if a
  // later stage throws — coverage-gap analytics depend on city /
  // neighborhood from intent, not just from successful runs.
  let intentForLog: ParsedIntent | null = null

  try {
    // 1. Parse intent
    const intent: ParsedIntent = await tracer.span('intent_parser', async (ctx) => {
      const { intent, usage } = await parseIntent(query)
      ctx.setLlmUsage(usage)
      return intent
    })
    intentForLog = intent

    // 2. Retrieve candidates
    const retrieval: RetrievalResult = await tracer.span('retriever', async () => {
      return retrieveCafes(intent)
    })

    if (retrieval.candidates.length === 0) {
      // Bail with a still-useful trace.
      const run = tracer.finalize({
        query,
        recommendation: null,
        evaluation: null,
        fatal: { message: 'No candidate cafes found' },
      })
      // Fire-and-forget; never awaited so we don't block the response.
      void logAgentRun({ run, intent: intentForLog })
      return NextResponse.json(run, { status: 200 })
    }

    // 3. Score fit
    const scored = await tracer.span('fit_scorer', async () => {
      return scoreCandidates(intent, retrieval.candidates)
    })

    // 4. Write recommendation
    recommendation = await tracer.span('recommender', async (ctx) => {
      const { recommendation, usage } = await writeRecommendation({
        intent,
        scored,
        spots: retrieval.candidates,
      })
      ctx.setLlmUsage(usage)
      return recommendation
    })

    // 5. Evaluate
    evaluation = await tracer.span('evaluator', async (ctx) => {
      const { evaluation, usage } = await evaluate({
        originalQuery: query,
        intent,
        recommendation: recommendation!,
      })
      ctx.setLlmUsage(usage)
      return evaluation
    })

    const run = tracer.finalize({ query, recommendation, evaluation })
    void logAgentRun({ run, intent: intentForLog })
    return NextResponse.json(run, { status: 200 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const run = tracer.finalize({
      query,
      recommendation,
      evaluation,
      fatal: { message },
    })
    void logAgentRun({ run, intent: intentForLog })
    // Use 200 + fatal flag so the client can still render the
    // partial trace for debugging — the alternative (500) hides
    // useful observability data behind a generic error toast.
    return NextResponse.json(run, { status: 200 })
  }
}
