// ─────────────────────────────────────────────────────────────
// Cafelist /labs — Agent pipeline shared types
//
// The /labs feature is an isolated experimental agent layer that
// turns a natural-language request like
//   "somewhere in Manhattan to work for 3 hours after 6pm, not too
//    loud, outlets preferred, near the F train"
// into a structured recommendation, with a full trace of how it
// got there. These types model the contract between each stage
// (parse → retrieve → score → write → evaluate).
// ─────────────────────────────────────────────────────────────

import type { NoiseLevel, Spot, SpotType } from '@/types'

// ── 1. Parsed intent ─────────────────────────────────────────
// Every field is optional because users typically only specify a
// handful of constraints. `priorities` lets the scorer know which
// constraints the user emphasised vs. which were nice-to-haves.

export type Priority = 'must' | 'should' | 'nice'

export interface ParsedIntent {
  /** Original raw text — preserved for prompts downstream. */
  rawQuery: string

  /** Geo constraints. */
  city: string | null
  neighborhood: string | null
  transit: string[] // e.g. ["F train", "L train"]

  /** Time constraints. */
  timeOfDay: string | null // "after 6pm", "morning", "now"
  startTimeIso: string | null // resolved absolute time if computable
  durationMinutes: number | null
  /** Day of week the user is planning for, e.g. "saturday". Set by the
   *  V2 picker (ticket #7) from the picker's weekday widget; not yet
   *  consumed by retriever/scorer — present so logger captures it for
   *  coverage-gap analytics and a future ticket can teach the pipeline
   *  to use it. Null when the user did not specify a day. */
  weekday: string | null

  /** Environment constraints. */
  noiseTolerance: NoiseLevel | null // user's max tolerated noise
  vibe: string[] // e.g. ["cozy", "industrial", "quiet"]

  /** Feature constraints. */
  needsOutlets: boolean | null
  needsWifi: boolean | null
  laptopFriendly: boolean | null
  needsFood: boolean | null

  /** Negatives. */
  avoid: string[] // e.g. ["chains", "loud bars", "tourist traps"]

  /** Spot type preference (if implied). */
  preferredTypes: SpotType[]

  /** Per-constraint priority. Keys are intent field names. */
  priorities: Partial<Record<keyof Omit<ParsedIntent, 'rawQuery' | 'priorities'>, Priority>>
}

// ── 2. Retrieval ─────────────────────────────────────────────

export interface RetrievalResult {
  candidates: Spot[]
  totalSearched: number
  source: 'supabase' | 'demo'
  filtersApplied: string[]
}

// ── 3. Fit scoring ───────────────────────────────────────────

export interface FitScore {
  spotId: string
  spotName: string
  fitScore: number // 0–100
  confidence: number // 0–1
  reasons: string[] // why this is a good fit ("Open until 11pm — matches 'after 6pm'")
  tradeoffs: string[] // what's imperfect ("Noise level 'moderate' — you asked for quiet")
  missingData: string[] // signals we couldn't verify ("No data on F-train proximity")
  componentScores: {
    location: number
    time: number
    noise: number
    features: number
    vibe: number
  }
}

// ── 4. Recommendation ────────────────────────────────────────

export interface RecommendationPick {
  spotId: string
  spotName: string
  oneLiner: string // best use case for this pick
  tradeoff: string // single honest tradeoff
  /** URL slug for /spot/[slug]. Populated by the route after the
   *  LLM responds (the model only emits spotId/spotName; the route
   *  looks up the slug from the retrieved spots and attaches it).
   *  Optional so older callers and fixtures still type-check. */
  slug?: string
}

export interface Recommendation {
  summary: string // short, conversational opening line
  picks: RecommendationPick[] // top 3 (or fewer if data is thin)
  backup: RecommendationPick | null
  confidenceNote: string // "high — all three are open right now" / "medium — F-train proximity not verified"
  caveats: string[]
}

// ── 5. Evaluation ────────────────────────────────────────────

export interface Evaluation {
  pass: boolean
  qualityScore: number // 0–10
  missedConstraints: string[]
  missingData: string[]
  suggestedImprovement: string | null
}

// ── 6. Trace / observability ─────────────────────────────────

export type TraceStage =
  | 'intent_parser'
  | 'retriever'
  | 'fit_scorer'
  | 'recommender'
  | 'evaluator'

export interface TraceEvent {
  stage: TraceStage
  startedAt: string // ISO
  durationMs: number
  ok: boolean
  errorMessage?: string
  /** Stage-specific payload for the UI to render. Kept loose so each
   * stage owns its own shape. */
  output: unknown
  /** Token usage and estimated cost when the stage called an LLM. */
  llm?: LlmUsage
}

export interface LlmUsage {
  model: string
  inputTokens: number
  outputTokens: number
  /** USD, rounded to 6 decimals. */
  estimatedCostUsd: number
}

export interface AgentRun {
  runId: string
  query: string
  startedAt: string
  totalDurationMs: number
  /** Resolved final answer. */
  recommendation: Recommendation | null
  evaluation: Evaluation | null
  /** Per-stage trace. */
  trace: TraceEvent[]
  /** Aggregate cost across all LLM calls. */
  totalCostUsd: number
  /** True when the orchestrator hit a fatal error. */
  fatal: boolean
  fatalMessage?: string
}
