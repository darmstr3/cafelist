// ─────────────────────────────────────────────────────────────
// Trace builder for the /labs agent pipeline.
//
// Each stage runs inside `tracer.span(stageName, async () => ...)`.
// The tracer records start time, latency, ok/err state, stage
// output, and any LLM usage. At the end the orchestrator calls
// `tracer.finalize(...)` to produce a single AgentRun object that
// the API returns and the UI renders.
// ─────────────────────────────────────────────────────────────

import { randomUUID } from 'crypto'
import type {
  AgentRun,
  Evaluation,
  LlmUsage,
  Recommendation,
  TraceEvent,
  TraceStage,
} from './types'

export class Tracer {
  readonly runId = randomUUID()
  readonly startedAt = new Date().toISOString()
  private start = Date.now()
  private events: TraceEvent[] = []

  /**
   * Run an async stage and record a trace event for it.
   *
   * The handler is given a `setLlmUsage` callback so it can attach
   * Claude usage (tokens + cost) to the trace for this stage.
   */
  async span<T>(
    stage: TraceStage,
    handler: (ctx: { setLlmUsage: (u: LlmUsage) => void }) => Promise<T>
  ): Promise<T> {
    const startedAt = new Date().toISOString()
    const t0 = Date.now()
    let llm: LlmUsage | undefined
    const ctx = { setLlmUsage: (u: LlmUsage) => { llm = u } }

    try {
      const output = await handler(ctx)
      const event: TraceEvent = {
        stage,
        startedAt,
        durationMs: Date.now() - t0,
        ok: true,
        output,
        llm,
      }
      this.events.push(event)
      // Structured log line for Vercel runtime logs.
      console.log(
        JSON.stringify({
          level: 'info',
          tag: 'labs.trace',
          runId: this.runId,
          stage,
          durationMs: event.durationMs,
          ok: true,
          llm: llm ?? null,
        })
      )
      return output
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.events.push({
        stage,
        startedAt,
        durationMs: Date.now() - t0,
        ok: false,
        errorMessage: message,
        output: null,
        llm,
      })
      console.error(
        JSON.stringify({
          level: 'error',
          tag: 'labs.trace',
          runId: this.runId,
          stage,
          durationMs: Date.now() - t0,
          ok: false,
          error: message,
        })
      )
      throw err
    }
  }

  finalize(args: {
    query: string
    recommendation: Recommendation | null
    evaluation: Evaluation | null
    fatal?: { message: string }
  }): AgentRun {
    const totalCostUsd = this.events.reduce(
      (sum, e) => sum + (e.llm?.estimatedCostUsd ?? 0),
      0
    )
    return {
      runId: this.runId,
      query: args.query,
      startedAt: this.startedAt,
      totalDurationMs: Date.now() - this.start,
      recommendation: args.recommendation,
      evaluation: args.evaluation,
      trace: this.events,
      totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
      fatal: !!args.fatal,
      fatalMessage: args.fatal?.message,
    }
  }
}
