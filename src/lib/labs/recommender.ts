// ─────────────────────────────────────────────────────────────
// Recommendation writer — turns the top-K scored candidates and the
// parsed intent into a short, conversational recommendation.
//
// We give Claude exactly the structured data it needs (parsed
// intent + scored shortlist) and ask for a tight JSON response.
// The model is not asked to invent facts — every reason/tradeoff
// it cites comes from the scorer.
// ─────────────────────────────────────────────────────────────

import { callClaudeJson } from './anthropic'
import type { FitScore, LlmUsage, ParsedIntent, Recommendation } from './types'
import type { Spot } from '@/types'

// Exported so the /labs/eval harness can hash the prompt to detect
// drift across runs without a manual version bump.
export const SYSTEM_PROMPT = `You write concise café recommendations for a remote-work directory.

You receive (1) a parsed user intent and (2) a ranked shortlist of cafes with fit scores, reasons, tradeoffs, and missing data already computed for you. Use ONLY those facts — do not invent details.

CRITICAL — ALWAYS RECOMMEND:
- You MUST return at least one pick. Never zero. Never refuse.
- Never start the summary with "Unfortunately", "Sorry", "None of these…", or any apology.
- If the shortlist is a poor match overall, that does not change your job. Recommend the best 1-3 of what is available and be transparent about the gap. The user can decide whether the tradeoffs are acceptable.
- Lead the summary with what the top pick OFFERS, not with what's missing. Missing pieces go in the tradeoff field, confidenceNote, and caveats — never in the summary's opening clause.

Your response must be a JSON object with this shape:
{
  "summary": string,             // one warm, plainspoken sentence leading with the best pick's strengths
  "picks": [                     // 1–3 picks in ranked order. ALWAYS at least 1.
    {
      "spotId": string,          // must match the input
      "spotName": string,
      "oneLiner": string,        // best use case for this pick, 1 sentence
      "tradeoff": string         // single honest tradeoff in 1 short phrase ("but the noise is moderate")
    }
  ],
  "backup": null | {             // 4th option only if shortlist has 4+
    "spotId": string,
    "spotName": string,
    "oneLiner": string,
    "tradeoff": string
  },
  "confidenceNote": string,      // calibrate honestly: "high — all open after 6pm" / "low — closest match misses the after-6pm window, treat as a fallback"
  "caveats": string[]            // unverified facts, drawn from the input's missingData
}

When fit is poor, calibrate. A "low" confidenceNote and a frank tradeoff line are how you stay honest WITHOUT refusing. Examples of good low-fit summaries:
- "Closest fit is Joe Coffee Waverly — solid wifi and outlets in the Village, though it closes at 8pm so a 3-hour evening stay is tight."
- "Bushwick Grind is the best of this set for an after-6pm laptop session — moderate noise, but open till 11pm and outlet-rich."

Style: warm, specific, no marketing fluff. Don't repeat the user's full query back at them. Don't use "perfect", "ideal", "amazing".
Return ONLY the JSON. No prose, no markdown fences.`

export interface RecommenderInput {
  intent: ParsedIntent
  scored: FitScore[]
  spots: Spot[]
}

export interface RecommenderResult {
  recommendation: Recommendation
  usage: LlmUsage
}

export async function writeRecommendation(
  input: RecommenderInput
): Promise<RecommenderResult> {
  // Take the top 4 (3 picks + 1 backup) to keep the prompt small.
  const topK = input.scored.slice(0, 4)
  const spotMap = new Map(input.spots.map((s) => [s.id, s]))

  const shortlist = topK.map((s) => {
    const spot = spotMap.get(s.spotId)
    return {
      spotId: s.spotId,
      spotName: s.spotName,
      type: spot?.type,
      neighborhood: spot?.neighborhood,
      city: spot?.city,
      address: spot?.address,
      fitScore: s.fitScore,
      confidence: s.confidence,
      reasons: s.reasons,
      tradeoffs: s.tradeoffs,
      missingData: s.missingData,
      hours: spot?.hours ?? null,
      vibe_tags: spot?.vibe_tags ?? [],
    }
  })

  const userMsg = `User intent (parsed):
${JSON.stringify(input.intent, null, 2)}

Ranked shortlist:
${JSON.stringify(shortlist, null, 2)}

Write the recommendation JSON now.`

  const { data, usage } = await callClaudeJson<Recommendation>({
    system: SYSTEM_PROMPT,
    user: userMsg,
    maxTokens: 900,
  })

  // Defensive normalization.
  const recommendation: Recommendation = {
    summary: data.summary ?? '',
    picks: Array.isArray(data.picks) ? data.picks.slice(0, 3) : [],
    backup: data.backup ?? null,
    confidenceNote: data.confidenceNote ?? '',
    caveats: Array.isArray(data.caveats) ? data.caveats : [],
  }

  // Safety net: the model is instructed to always return at least one
  // pick, but if it refuses anyway (or a parse hiccup empties picks),
  // backfill from the top of the scored list and downgrade confidence.
  // "Always answer, with calibrated confidence" is the product contract
  // for this surface — silence is the worst possible failure mode.
  if (recommendation.picks.length === 0 && topK.length > 0) {
    recommendation.picks = topK.slice(0, Math.min(3, topK.length)).map((s) => {
      const spot = spotMap.get(s.spotId)
      const tradeoff =
        s.tradeoffs[0] ??
        (s.missingData[0] ? `${s.missingData[0]} (unverified)` : 'imperfect match for this request')
      return {
        spotId: s.spotId,
        spotName: s.spotName,
        oneLiner:
          s.reasons[0] ??
          (spot
            ? `${spot.neighborhood ?? spot.city} option from the directory`
            : 'option from the directory'),
        tradeoff,
      }
    })
    if (!recommendation.summary || /^(unfortunately|sorry|none)/i.test(recommendation.summary)) {
      recommendation.summary = `Closest fit is ${recommendation.picks[0].spotName} — not a perfect match, but the best of what's available for this request.`
    }
    if (!recommendation.confidenceNote) {
      recommendation.confidenceNote = 'low — none of these are a strong match, treat as fallbacks'
    }
  }

  return { recommendation, usage }
}
