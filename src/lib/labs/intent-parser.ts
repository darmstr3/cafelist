// ─────────────────────────────────────────────────────────────
// Intent parser — turns a natural-language café request into a
// structured ParsedIntent that the rest of the pipeline can act on.
//
// The schema we ask Claude to produce is intentionally narrow:
// fields the retriever/scorer can actually use (city, noise,
// outlets, transit, etc.), nothing decorative. Anything Claude
// isn't sure about should come back as null — null travels through
// the scorer as "no constraint to enforce", not as a wrong guess.
// ─────────────────────────────────────────────────────────────

import { callClaudeJson } from './anthropic'
import type { LlmUsage } from './types'
import type { ParsedIntent } from './types'

// Exported so the /labs/eval harness can hash the prompt to detect
// drift across runs without a manual version bump.
export const SYSTEM_PROMPT = `You are an intent parser for a coffee-shop recommendation agent.

Your job: turn a single user message into a strict JSON object describing the constraints they expressed.

Rules:
- Return ONLY a JSON object. No prose, no markdown, no code fences.
- If the user did not mention a constraint, return null (or [] for list fields). Do not invent.
- "Manhattan", "Brooklyn" etc are NEIGHBORHOODS within the city "New York City". Map borough/area names to neighborhood, set city accordingly.
- noiseTolerance is the LOUDEST noise the user would accept. "not too loud" / "quiet" → "quiet". "doesn't matter" → null.
- For times like "after 6pm", set timeOfDay to the user's phrasing and leave startTimeIso null unless they specified an exact date.
- duration: convert "3 hours" → 180. "a couple hours" → 120.
- priorities: for each field the user actually mentioned, classify as:
    "must" = explicit hard requirement ("must have outlets", "needs to be quiet")
    "should" = stated preference ("outlets preferred", "ideally quiet")
    "nice"  = soft / mentioned in passing
  Only include fields the user actually expressed.

JSON schema:
{
  "city": string | null,
  "neighborhood": string | null,
  "transit": string[],
  "timeOfDay": string | null,
  "startTimeIso": string | null,
  "durationMinutes": number | null,
  "noiseTolerance": "silent" | "quiet" | "moderate" | "loud" | null,
  "vibe": string[],
  "needsOutlets": boolean | null,
  "needsWifi": boolean | null,
  "laptopFriendly": boolean | null,
  "needsFood": boolean | null,
  "avoid": string[],
  "preferredTypes": ("coffee_shop" | "hotel_lobby" | "diner" | "bar" | "library" | "coworking" | "other")[],
  "priorities": { "<fieldName>": "must" | "should" | "nice" }
}`

export interface IntentParserResult {
  intent: ParsedIntent
  usage: LlmUsage
}

export async function parseIntent(rawQuery: string): Promise<IntentParserResult> {
  const { data, usage } = await callClaudeJson<Omit<ParsedIntent, 'rawQuery'>>({
    system: SYSTEM_PROMPT,
    user: `User request:\n"""${rawQuery}"""\n\nReturn the JSON object now.`,
    maxTokens: 600,
  })

  // Defensive normalization — Claude is generally compliant but we
  // never want a missing field to crash the scorer.
  const intent: ParsedIntent = {
    rawQuery,
    city: data.city ?? null,
    neighborhood: data.neighborhood ?? null,
    transit: Array.isArray(data.transit) ? data.transit : [],
    timeOfDay: data.timeOfDay ?? null,
    startTimeIso: data.startTimeIso ?? null,
    durationMinutes:
      typeof data.durationMinutes === 'number' ? data.durationMinutes : null,
    // The V1 free-text parser doesn't extract weekday; the V2 picker
    // supplies it directly. Default null so the ParsedIntent type
    // stays satisfied without changing the LLM prompt schema.
    weekday: typeof data.weekday === 'string' ? data.weekday : null,
    noiseTolerance: data.noiseTolerance ?? null,
    vibe: Array.isArray(data.vibe) ? data.vibe : [],
    needsOutlets: data.needsOutlets ?? null,
    needsWifi: data.needsWifi ?? null,
    laptopFriendly: data.laptopFriendly ?? null,
    needsFood: data.needsFood ?? null,
    avoid: Array.isArray(data.avoid) ? data.avoid : [],
    preferredTypes: Array.isArray(data.preferredTypes) ? data.preferredTypes : [],
    priorities: data.priorities && typeof data.priorities === 'object' ? data.priorities : {},
  }

  return { intent, usage }
}
