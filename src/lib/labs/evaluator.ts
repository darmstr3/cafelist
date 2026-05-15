// ─────────────────────────────────────────────────────────────
// Evaluator — given the original query and the final recommendation,
// decide whether the agent actually satisfied the user.
//
// This is the "did we deliver?" check that closes the agent loop.
// We use a separate LLM call (rather than reusing the recommender)
// because we want an independent judge, not the same model marking
// its own homework — that's a more honest portfolio story.
// ─────────────────────────────────────────────────────────────

import { callClaudeJson } from './anthropic'
import type { Evaluation, LlmUsage, ParsedIntent, Recommendation } from './types'

// Exported so the /labs/eval harness can hash the prompt to detect
// drift across runs without a manual version bump.
export const SYSTEM_PROMPT = `You evaluate the output of a café recommendation agent.

You receive (1) the original user query, (2) the parsed intent the agent worked from, and (3) the final recommendation the agent produced.

Score the recommendation honestly. A pass means: it directly addresses every "must" priority, makes sensible tradeoffs for "shoulds", and is transparent about anything it couldn't verify.

Return ONLY this JSON shape:
{
  "pass": boolean,
  "qualityScore": number,         // 0-10, integer or one decimal
  "missedConstraints": string[],  // explicit user asks the recommendation ignored
  "missingData": string[],        // facts the recommendation should have flagged as unverified
  "suggestedImprovement": string | null  // one short sentence on what would have made it better
}

Bias toward strictness on "must" priorities. Bias toward leniency on vibe / nice-to-haves.
Do not invent constraints the user did not express. No markdown, no code fences.`

export interface EvaluatorInput {
  originalQuery: string
  intent: ParsedIntent
  recommendation: Recommendation
}

export interface EvaluatorResult {
  evaluation: Evaluation
  usage: LlmUsage
}

export async function evaluate(input: EvaluatorInput): Promise<EvaluatorResult> {
  const userMsg = `Original user query:
"""${input.originalQuery}"""

Parsed intent:
${JSON.stringify(input.intent, null, 2)}

Final recommendation:
${JSON.stringify(input.recommendation, null, 2)}

Evaluate now.`

  const { data, usage } = await callClaudeJson<Evaluation>({
    system: SYSTEM_PROMPT,
    user: userMsg,
    maxTokens: 500,
  })

  const evaluation: Evaluation = {
    pass: !!data.pass,
    qualityScore:
      typeof data.qualityScore === 'number'
        ? Math.max(0, Math.min(10, data.qualityScore))
        : 0,
    missedConstraints: Array.isArray(data.missedConstraints) ? data.missedConstraints : [],
    missingData: Array.isArray(data.missingData) ? data.missingData : [],
    suggestedImprovement: data.suggestedImprovement ?? null,
  }

  return { evaluation, usage }
}
