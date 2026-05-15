// ─────────────────────────────────────────────────────────────
// Thin Anthropic client wrapper for the /labs agent pipeline.
//
// Goals:
// - Single place to set the model + system style.
// - Force JSON-shaped responses (with one retry on parse failure)
//   so downstream stages get typed objects, not free-form prose.
// - Capture token usage + estimated cost on every call so the
//   trace can show "how much did this thought cost".
// - Stay graceful when ANTHROPIC_API_KEY is missing — the API
//   route will surface a clear error rather than crashing.
// ─────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk'
import type { LlmUsage } from './types'

// Haiku 4.5 is the default — cheap, fast, plenty smart for parsing
// and short narrative generation. Override per-call if you want
// Sonnet for the recommender.
export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'

// Public pricing (May 2026) per million tokens, USD.
// Source: anthropic.com/pricing — update here if pricing changes.
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4 },
  'claude-haiku-4-5': { input: 0.8, output: 4 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-4-6': { input: 15, output: 75 },
}

function priceFor(model: string) {
  return PRICING[model] ?? PRICING['claude-haiku-4-5-20251001']
}

let _client: Anthropic | null = null

function getClient(): Anthropic {
  if (_client) return _client
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to .env.local (and Vercel) before using /labs.'
    )
  }
  _client = new Anthropic({ apiKey })
  return _client
}

export interface LlmCallOptions {
  model?: string
  system: string
  user: string
  /** Max output tokens. Keep modest — these are small structured
   * payloads, not essays. */
  maxTokens?: number
  /** Optional assistant prefill to coerce the response toward JSON. */
  prefill?: string
}

export interface LlmJsonResult<T> {
  data: T
  usage: LlmUsage
  raw: string
}

/**
 * Calls Claude and parses the response as JSON.
 *
 * Strategy: we instruct the model to return JSON only, prefill the
 * assistant turn with `{` so it can't preface with chatter, then
 * parse. If parsing fails we retry once with an explicit "you
 * returned invalid JSON, return ONLY a valid JSON object" message.
 */
export async function callClaudeJson<T = unknown>(
  opts: LlmCallOptions
): Promise<LlmJsonResult<T>> {
  const model = opts.model ?? DEFAULT_MODEL
  const maxTokens = opts.maxTokens ?? 1024
  const prefill = opts.prefill ?? '{'

  const client = getClient()

  const attempt = async (userMsg: string): Promise<{ text: string; usage: LlmUsage }> => {
    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: opts.system,
      messages: [
        { role: 'user', content: userMsg },
        { role: 'assistant', content: prefill },
      ],
    })
    const textBlock = res.content.find((b) => b.type === 'text')
    const raw = textBlock && textBlock.type === 'text' ? textBlock.text : ''
    // Reattach the prefill so the parser sees the full JSON.
    const text = prefill + raw

    const price = priceFor(model)
    const inputTokens = res.usage.input_tokens
    const outputTokens = res.usage.output_tokens
    const estimatedCostUsd =
      (inputTokens * price.input + outputTokens * price.output) / 1_000_000

    return {
      text,
      usage: {
        model,
        inputTokens,
        outputTokens,
        estimatedCostUsd: Math.round(estimatedCostUsd * 1_000_000) / 1_000_000,
      },
    }
  }

  // First attempt.
  let { text, usage } = await attempt(opts.user)
  try {
    return { data: extractJson<T>(text), usage, raw: text }
  } catch (e1) {
    // Second attempt — be very explicit. Merge the two usages so
    // the trace reflects the real cost paid.
    const retryUser =
      opts.user +
      '\n\nYou previously returned a response that could not be parsed as JSON. ' +
      'Return ONLY a single JSON object matching the schema above. No prose, no markdown fences.'
    const retry = await attempt(retryUser)
    text = retry.text
    usage = {
      model: usage.model,
      inputTokens: usage.inputTokens + retry.usage.inputTokens,
      outputTokens: usage.outputTokens + retry.usage.outputTokens,
      estimatedCostUsd:
        Math.round((usage.estimatedCostUsd + retry.usage.estimatedCostUsd) * 1_000_000) /
        1_000_000,
    }
    try {
      return { data: extractJson<T>(text), usage, raw: text }
    } catch (e2) {
      throw new Error(
        `Claude returned invalid JSON after retry. Last response: ${text.slice(0, 400)}... (parse error: ${(e2 as Error).message})`
      )
    }
  }
}

/** Strip markdown code fences if present, then JSON.parse. */
function extractJson<T>(text: string): T {
  let trimmed = text.trim()
  // Strip ```json ... ``` or ``` ... ``` fences.
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/m
  const m = trimmed.match(fence)
  if (m) trimmed = m[1].trim()
  return JSON.parse(trimmed) as T
}
