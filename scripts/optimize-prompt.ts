// ─────────────────────────────────────────────────────────────
// scripts/optimize-prompt.ts
//
// Prompt Optimizer Agent — automated search over the prompt
// space for one stage of the /labs pipeline.
//
//   npx tsx scripts/optimize-prompt.ts <stage> [--dry-run] [--cap=0.50]
//
//   stage ∈ { recommender | evaluator | intent-parser }
//
// What it does:
//   1. Reads SYSTEM_PROMPT from the stage's source file.
//   2. Runs the eval suite once on the current prompt to establish
//      a baseline (caches the per-query intent / retrieval / scored
//      shortlist so unrelated stages don't get re-billed).
//   3. Asks Claude Sonnet to draft 4 variants, each emphasizing a
//      different rewriting strategy: concrete, strict, conversational,
//      tighter output constraints.
//   4. Re-runs the eval suite for each variant, swapping ONLY the
//      stage being optimized. Reuses cached intermediates everywhere
//      else.
//   5. Promotion rule: a variant wins iff
//          avg quality is >5% better than baseline AND
//          no individual case regresses by more than 1.0 point.
//      Tie / inconclusive → keep current prompt.
//   6. On promotion: rewrite the source file, append a JOURNAL.md
//      entry, git commit with an eval-delta message.
//   7. Logs every variant (including baseline) to public.agent_prompt_runs
//      so the journey is auditable.
//   8. Hard cost cap (default $0.50). Aborts the round mid-flight
//      if exceeded — partial results still written to the table.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs'
import { resolve } from 'path'
import { execSync } from 'child_process'
import { createHash, randomUUID } from 'crypto'
import Anthropic from '@anthropic-ai/sdk'

// ── Sandbox proxy boilerplate ────────────────────────────────
// Mirror labs-eval-full.ts: when an HTTPS proxy is set (sandbox /
// dev environments), the proxy presents a self-signed cert. Disable
// cert verification on that hop only. Production never runs this.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ProxyAgent, setGlobalDispatcher } = require('undici')
const _proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy
if (_proxyUrl) {
  setGlobalDispatcher(
    new ProxyAgent({
      uri: _proxyUrl,
      requestTls: { rejectUnauthorized: false },
      proxyTls: { rejectUnauthorized: false },
    })
  )
}

// ── .env.local loader (no dotenv dep) ────────────────────────
function loadDotenv(path: string) {
  try {
    const raw = readFileSync(path, 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      if (process.env[m[1]] === undefined) {
        let val = m[2]
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1)
        }
        process.env[m[1]] = val
      }
    }
  } catch {
    /* file missing is fine */
  }
}
loadDotenv(resolve(process.cwd(), '.env.local'))

// Late imports so env vars are set first.
import { parseIntent } from '../src/lib/labs/intent-parser'
import { retrieveCafes } from '../src/lib/labs/retriever'
import { scoreCandidates } from '../src/lib/labs/fit-scorer'
import { writeRecommendation } from '../src/lib/labs/recommender'
import { evaluate } from '../src/lib/labs/evaluator'
import type {
  Evaluation,
  FitScore,
  LlmUsage,
  ParsedIntent,
  Recommendation,
} from '../src/lib/labs/types'
import type { Spot } from '../src/types'
import { createClient } from '@supabase/supabase-js'

// ── Constants ────────────────────────────────────────────────

type Stage = 'recommender' | 'evaluator' | 'intent-parser'

const SONNET_MODEL = 'claude-sonnet-4-6'
const HAIKU_MODEL = 'claude-haiku-4-5-20251001'

// Pricing per 1M tokens, USD. Keep in sync with src/lib/labs/anthropic.ts.
const PRICING: Record<string, { input: number; output: number }> = {
  [HAIKU_MODEL]: { input: 0.8, output: 4 },
  [SONNET_MODEL]: { input: 3, output: 15 },
}

// Same eight queries the live eval harness uses. Keeping them in sync
// matters: if the optimizer thinks a prompt is better but the harness
// disagrees, the journal becomes hard to interpret.
const QUERIES: string[] = [
  'I need somewhere in Manhattan to work for 3 hours after 6pm, not too loud, outlets preferred, near the F train.',
  'A quiet coffee shop in Brooklyn open past midnight, must have wifi, no chains.',
  'Late-night spot in Austin to write, vibe-y, ok if a bit loud as long as wifi is solid.',
  'Place to take a 90-minute call in San Francisco SoMa tomorrow morning — calm vibe, outlets, food nearby.',
  'Anywhere I can sit for 4 hours with strong wifi in NYC.',
  "I want a hotel lobby in Midtown that's open 24/7 with comfortable seating.",
  "Quick coffee in West Village, in and out, doesn't matter if it's loud.",
  'Help me find a quiet library-like cafe in Chicago to focus.',
]

const STAGE_SOURCE: Record<Stage, string> = {
  recommender: 'src/lib/labs/recommender.ts',
  evaluator: 'src/lib/labs/evaluator.ts',
  'intent-parser': 'src/lib/labs/intent-parser.ts',
}

const STRATEGIES: Array<{ id: string; label: string; instruction: string }> = [
  {
    id: 'concrete',
    label: 'more concrete',
    instruction:
      'Rewrite the prompt to be MORE CONCRETE: add 2–3 short illustrative examples of good outputs, name specific failure modes to avoid, and replace abstract verbs ("evaluate", "consider") with concrete ones ("count", "verify", "name"). Do not change the JSON output schema.',
  },
  {
    id: 'strict',
    label: 'stricter',
    instruction:
      'Rewrite the prompt to be STRICTER: tighten what counts as success, add explicit "MUST" / "MUST NOT" rules, and require the model to call out tradeoffs explicitly. Do not change the JSON output schema.',
  },
  {
    id: 'conversational',
    label: 'more conversational',
    instruction:
      'Rewrite the prompt to be MORE CONVERSATIONAL: explain the WHY behind each rule in one short sentence so the model has context for edge cases, replace robotic command lists with natural prose. Keep all behavioral constraints. Do not change the JSON output schema.',
  },
  {
    id: 'constrained',
    label: 'tighter output constraints',
    instruction:
      'Rewrite the prompt to TIGHTEN OUTPUT CONSTRAINTS: cap field lengths in words, forbid filler phrases by name (e.g. "perfect", "amazing", "I think"), and require every claim to be traceable to an input field. Do not change the JSON output schema itself.',
  },
]

// ── Small helpers ────────────────────────────────────────────

function priceFor(model: string) {
  return PRICING[model] ?? PRICING[HAIKU_MODEL]
}

function costFromUsage(model: string, inputTokens: number, outputTokens: number) {
  const p = priceFor(model)
  return Math.round(((inputTokens * p.input + outputTokens * p.output) / 1_000_000) * 1_000_000) / 1_000_000
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

function parseArgs(argv: string[]): { stage: Stage; dryRun: boolean; cap: number } {
  const args = argv.slice(2)
  const stage = args.find((a) => !a.startsWith('-')) as Stage | undefined
  if (!stage || !(stage in STAGE_SOURCE)) {
    console.error('Usage: npx tsx scripts/optimize-prompt.ts <stage> [--dry-run] [--cap=0.50]')
    console.error("  stage ∈ { recommender | evaluator | intent-parser }")
    process.exit(2)
  }
  const dryRun = args.includes('--dry-run')
  const capArg = args.find((a) => a.startsWith('--cap='))
  const cap = capArg ? Number(capArg.split('=')[1]) : 0.5
  if (!Number.isFinite(cap) || cap <= 0) {
    console.error('--cap must be a positive number (USD)')
    process.exit(2)
  }
  return { stage, dryRun, cap }
}

// Match `const SYSTEM_PROMPT = `...`` (template literal, possibly multiline).
// The non-greedy capture stops at the FIRST closing backtick that is
// followed by optional whitespace and a semicolon — the natural
// terminator for a const declaration in our codebase.
const PROMPT_REGEX = /const\s+SYSTEM_PROMPT\s*=\s*`([\s\S]*?)`\s*;?/m

function extractPrompt(source: string): { prompt: string; match: RegExpMatchArray } {
  const m = source.match(PROMPT_REGEX)
  if (!m) {
    throw new Error('Could not locate `const SYSTEM_PROMPT = `…`` in source file.')
  }
  return { prompt: m[1], match: m }
}

function replacePromptInSource(source: string, newPrompt: string): string {
  // Rebuild as `const SYSTEM_PROMPT = \`…\`` with the new body.
  // We escape backticks and ${} sequences so the rewritten file
  // still parses (Claude shouldn't generate them, but defensive
  // belt-and-braces is cheap).
  const escaped = newPrompt.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
  return source.replace(PROMPT_REGEX, `const SYSTEM_PROMPT = \`${escaped}\``)
}

// ── Anthropic client ─────────────────────────────────────────

let _client: Anthropic | null = null
function client(): Anthropic {
  if (_client) return _client
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set (.env.local).')
  _client = new Anthropic({ apiKey })
  return _client
}

interface JsonCallResult<T> {
  data: T
  usage: LlmUsage
}

/** JSON-prefilled Claude call. Used for both the variant generator
 * and the swapped-in stage calls. */
async function callJson<T>(args: {
  model: string
  system: string
  user: string
  maxTokens: number
}): Promise<JsonCallResult<T>> {
  const res = await client().messages.create({
    model: args.model,
    max_tokens: args.maxTokens,
    system: args.system,
    messages: [
      { role: 'user', content: args.user },
      { role: 'assistant', content: '{' },
    ],
  })
  const textBlock = res.content.find((b) => b.type === 'text')
  const raw = textBlock && textBlock.type === 'text' ? textBlock.text : ''
  const text = '{' + raw
  const trimmed = text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/m, '$1')
  const usage: LlmUsage = {
    model: args.model,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
    estimatedCostUsd: costFromUsage(args.model, res.usage.input_tokens, res.usage.output_tokens),
  }
  return { data: JSON.parse(trimmed) as T, usage }
}

// ── Variant generation ───────────────────────────────────────

interface Variant {
  id: string
  label: string
  prompt: string
}

async function generateVariants(
  stage: Stage,
  basePrompt: string
): Promise<{ variants: Variant[]; usage: LlmUsage }> {
  const system = `You are a prompt-engineering assistant helping improve one stage of a multi-stage LLM pipeline.

You will be given the current SYSTEM_PROMPT for the "${stage}" stage. Your job is to produce four rewrites, each emphasizing a different strategy.

Rules for every rewrite:
- Keep the SAME JSON output schema. The downstream code parses these fields by name; changing them breaks production.
- Keep the SAME core behavior. You are wordsmithing, not redesigning the stage.
- Keep prompts under ~3000 characters each. Brevity is a virtue.
- Do NOT add markdown code fences or commentary inside the prompt body.

Return strictly this JSON shape — no prose, no markdown:
{
  "variants": [
    { "id": "concrete",        "prompt": "..." },
    { "id": "strict",          "prompt": "..." },
    { "id": "conversational",  "prompt": "..." },
    { "id": "constrained",     "prompt": "..." }
  ]
}`

  const user = `Stage: ${stage}

Current SYSTEM_PROMPT (between the markers):
<<<PROMPT
${basePrompt}
PROMPT>>>

Produce one rewrite per strategy:

${STRATEGIES.map((s) => `- id="${s.id}" — ${s.instruction}`).join('\n')}

Return the JSON now.`

  const { data, usage } = await callJson<{ variants: Array<{ id: string; prompt: string }> }>({
    model: SONNET_MODEL,
    system,
    user,
    maxTokens: 8000,
  })

  const variants: Variant[] = STRATEGIES.map((s) => {
    const found = data.variants?.find((v) => v.id === s.id)
    if (!found || !found.prompt || typeof found.prompt !== 'string') {
      throw new Error(`Variant generator did not return a "${s.id}" prompt.`)
    }
    return { id: s.id, label: s.label, prompt: found.prompt.trim() }
  })

  return { variants, usage }
}

// ── Stage runners (system prompt is injectable) ──────────────
//
// These mirror the production stage files but accept an arbitrary
// system prompt. That's the trick that lets us A/B variants without
// monkey-patching the source files mid-process.

async function runRecommender(
  systemPrompt: string,
  intent: ParsedIntent,
  scored: FitScore[],
  spots: Spot[]
): Promise<{ recommendation: Recommendation; usage: LlmUsage }> {
  const topK = scored.slice(0, 4)
  const spotMap = new Map(spots.map((s) => [s.id, s]))
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
${JSON.stringify(intent, null, 2)}

Ranked shortlist:
${JSON.stringify(shortlist, null, 2)}

Write the recommendation JSON now.`

  const { data, usage } = await callJson<Recommendation>({
    model: HAIKU_MODEL,
    system: systemPrompt,
    user: userMsg,
    maxTokens: 900,
  })

  // Same defensive normalization as production.
  const rec: Recommendation = {
    summary: data.summary ?? '',
    picks: Array.isArray(data.picks) ? data.picks.slice(0, 3) : [],
    backup: data.backup ?? null,
    confidenceNote: data.confidenceNote ?? '',
    caveats: Array.isArray(data.caveats) ? data.caveats : [],
  }
  if (rec.picks.length === 0 && topK.length > 0) {
    rec.picks = topK.slice(0, Math.min(3, topK.length)).map((s) => {
      const spot = spotMap.get(s.spotId)
      const tradeoff =
        s.tradeoffs[0] ??
        (s.missingData[0] ? `${s.missingData[0]} (unverified)` : 'imperfect match for this request')
      return {
        spotId: s.spotId,
        spotName: s.spotName,
        oneLiner:
          s.reasons[0] ??
          (spot ? `${spot.neighborhood ?? spot.city} option from the directory` : 'option from the directory'),
        tradeoff,
      }
    })
    if (!rec.summary || /^(unfortunately|sorry|none)/i.test(rec.summary)) {
      rec.summary = `Closest fit is ${rec.picks[0].spotName} — not a perfect match, but the best of what's available.`
    }
    if (!rec.confidenceNote) rec.confidenceNote = 'low — none of these are a strong match, treat as fallbacks'
  }
  return { recommendation: rec, usage }
}

async function runEvaluator(
  systemPrompt: string,
  query: string,
  intent: ParsedIntent,
  recommendation: Recommendation
): Promise<{ evaluation: Evaluation; usage: LlmUsage }> {
  const userMsg = `Original user query:
"""${query}"""

Parsed intent:
${JSON.stringify(intent, null, 2)}

Final recommendation:
${JSON.stringify(recommendation, null, 2)}

Evaluate now.`

  const { data, usage } = await callJson<Evaluation>({
    model: HAIKU_MODEL,
    system: systemPrompt,
    user: userMsg,
    maxTokens: 500,
  })
  const evaluation: Evaluation = {
    pass: !!data.pass,
    qualityScore:
      typeof data.qualityScore === 'number' ? Math.max(0, Math.min(10, data.qualityScore)) : 0,
    missedConstraints: Array.isArray(data.missedConstraints) ? data.missedConstraints : [],
    missingData: Array.isArray(data.missingData) ? data.missingData : [],
    suggestedImprovement: data.suggestedImprovement ?? null,
  }
  return { evaluation, usage }
}

async function runIntentParser(
  systemPrompt: string,
  query: string
): Promise<{ intent: ParsedIntent; usage: LlmUsage }> {
  const { data, usage } = await callJson<Omit<ParsedIntent, 'rawQuery'>>({
    model: HAIKU_MODEL,
    system: systemPrompt,
    user: `User request:\n"""${query}"""\n\nReturn the JSON object now.`,
    maxTokens: 600,
  })
  const intent: ParsedIntent = {
    rawQuery: query,
    city: data.city ?? null,
    neighborhood: data.neighborhood ?? null,
    transit: Array.isArray(data.transit) ? data.transit : [],
    timeOfDay: data.timeOfDay ?? null,
    startTimeIso: data.startTimeIso ?? null,
    durationMinutes: typeof data.durationMinutes === 'number' ? data.durationMinutes : null,
    noiseTolerance: data.noiseTolerance ?? null,
    vibe: Array.isArray(data.vibe) ? data.vibe : [],
    needsOutlets: data.needsOutlets ?? null,
    needsWifi: data.needsWifi ?? null,
    laptopFriendly: data.laptopFriendly ?? null,
    needsFood: data.needsFood ?? null,
    avoid: Array.isArray(data.avoid) ? data.avoid : [],
    preferredTypes: Array.isArray(data.preferredTypes) ? data.preferredTypes : [],
    priorities: data.priorities && typeof data.priorities === 'object' ? (data.priorities as ParsedIntent['priorities']) : {},
  }
  return { intent, usage }
}

// ── Per-query baseline cache ─────────────────────────────────

interface QueryCache {
  query: string
  intent: ParsedIntent
  spots: Spot[]
  scored: FitScore[]
  recommendation: Recommendation
  evaluation: Evaluation
}

interface CaseScore {
  query: string
  qualityScore: number
  pass: boolean
  costUsd: number
  notes?: string
}

interface VariantResult {
  variantId: string
  label: string
  prompt: string
  cases: CaseScore[]
  avgQuality: number
  minScore: number
  passRate: number
  totalCost: number
}

// ── Cost guard ───────────────────────────────────────────────

class CostMeter {
  total = 0
  constructor(public cap: number) {}
  add(u: LlmUsage) {
    this.total += u.estimatedCostUsd
  }
  check(stage: string) {
    if (this.total > this.cap) {
      throw new CostExceededError(`Cost cap $${this.cap.toFixed(2)} exceeded ($${this.total.toFixed(4)}) during ${stage}`)
    }
  }
}
class CostExceededError extends Error {}

// ── Baseline runner ──────────────────────────────────────────

async function runBaseline(meter: CostMeter): Promise<QueryCache[]> {
  const cache: QueryCache[] = []
  for (const q of QUERIES) {
    process.stdout.write(`  baseline: ${q.slice(0, 60)}…\n`)
    const { intent, usage: u1 } = await parseIntent(q)
    meter.add(u1); meter.check('baseline:intent')
    const retrieval = await retrieveCafes(intent)
    const scored = scoreCandidates(intent, retrieval.candidates)
    const { recommendation, usage: u2 } = await writeRecommendation({
      intent,
      scored,
      spots: retrieval.candidates,
    })
    meter.add(u2); meter.check('baseline:recommender')
    const { evaluation, usage: u3 } = await evaluate({
      originalQuery: q,
      intent,
      recommendation,
    })
    meter.add(u3); meter.check('baseline:evaluator')
    cache.push({ query: q, intent, spots: retrieval.candidates, scored, recommendation, evaluation })
  }
  return cache
}

// ── Variant runner per stage ─────────────────────────────────

async function runVariantForStage(
  stage: Stage,
  prompt: string,
  baseline: QueryCache[],
  meter: CostMeter
): Promise<CaseScore[]> {
  const cases: CaseScore[] = []
  for (const c of baseline) {
    let caseCost = 0
    let qualityScore = 0
    let pass = false
    let notes: string | undefined

    try {
      if (stage === 'recommender') {
        // Reuse intent + scored; swap recommender; re-run evaluator (with the *original*
        // evaluator prompt — the judge stays constant).
        const { recommendation, usage: ur } = await runRecommender(prompt, c.intent, c.scored, c.spots)
        meter.add(ur); caseCost += ur.estimatedCostUsd
        meter.check('variant:recommender')
        const { evaluation, usage: ue } = await evaluate({
          originalQuery: c.query, intent: c.intent, recommendation,
        })
        meter.add(ue); caseCost += ue.estimatedCostUsd
        meter.check('variant:evaluator')
        qualityScore = evaluation.qualityScore
        pass = evaluation.pass
      } else if (stage === 'evaluator') {
        // Reuse everything through the recommendation; only the evaluator changes.
        const { evaluation, usage } = await runEvaluator(prompt, c.query, c.intent, c.recommendation)
        meter.add(usage); caseCost += usage.estimatedCostUsd
        meter.check('variant:evaluator')
        qualityScore = evaluation.qualityScore
        pass = evaluation.pass
      } else {
        // intent-parser: parser changes; downstream re-runs with production prompts.
        const { intent, usage: ui } = await runIntentParser(prompt, c.query)
        meter.add(ui); caseCost += ui.estimatedCostUsd
        meter.check('variant:intent-parser')
        const retrieval = await retrieveCafes(intent)
        const scored = scoreCandidates(intent, retrieval.candidates)
        const { recommendation, usage: ur } = await writeRecommendation({
          intent, scored, spots: retrieval.candidates,
        })
        meter.add(ur); caseCost += ur.estimatedCostUsd
        meter.check('variant:recommender')
        const { evaluation, usage: ue } = await evaluate({ originalQuery: c.query, intent, recommendation })
        meter.add(ue); caseCost += ue.estimatedCostUsd
        meter.check('variant:evaluator')
        qualityScore = evaluation.qualityScore
        pass = evaluation.pass
      }
    } catch (e) {
      if (e instanceof CostExceededError) throw e
      notes = `error: ${(e as Error).message.slice(0, 200)}`
      qualityScore = 0
      pass = false
    }

    cases.push({ query: c.query, qualityScore, pass, costUsd: caseCost, notes })
  }
  return cases
}

// ── Promotion logic ──────────────────────────────────────────

interface PromotionDecision {
  winnerId: string | null
  reason: string
  baselineAvg: number
  baselineMin: number
  bestVariant?: VariantResult
  perVariantAnalysis: Array<{ id: string; avg: number; deltaPct: number; worstRegression: number; eligible: boolean; reason: string }>
}

function summarize(cases: CaseScore[]): { avg: number; min: number; passRate: number } {
  const scores = cases.map((c) => c.qualityScore)
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length
  const min = Math.min(...scores)
  const passRate = cases.filter((c) => c.pass).length / cases.length
  return {
    avg: Math.round(avg * 100) / 100,
    min: Math.round(min * 100) / 100,
    passRate: Math.round(passRate * 1000) / 1000,
  }
}

function decide(baseline: VariantResult, variants: VariantResult[]): PromotionDecision {
  const perVariantAnalysis = variants.map((v) => {
    const deltaPct = baseline.avgQuality === 0
      ? 0
      : Math.round(((v.avgQuality - baseline.avgQuality) / baseline.avgQuality) * 10000) / 100
    // worstRegression: most-negative per-case delta vs baseline.
    // 0 means no regression. Positive means worst case got better.
    let worstRegression = Infinity
    for (let i = 0; i < v.cases.length; i++) {
      const delta = v.cases[i].qualityScore - baseline.cases[i].qualityScore
      if (delta < worstRegression) worstRegression = delta
    }
    worstRegression = Math.round(worstRegression * 100) / 100
    let eligible = true
    let reason = 'eligible'
    if (deltaPct <= 5) { eligible = false; reason = `avg quality delta ${deltaPct}% ≤ 5% threshold` }
    else if (worstRegression < -1) { eligible = false; reason = `worst case regressed by ${(-worstRegression).toFixed(2)} points (>1.0)` }
    return { id: v.variantId, avg: v.avgQuality, deltaPct, worstRegression, eligible, reason }
  })

  // Winner = eligible variant with highest avg quality.
  const eligibleVariants = variants.filter((v) => {
    const a = perVariantAnalysis.find((p) => p.id === v.variantId)!
    return a.eligible
  })
  if (eligibleVariants.length === 0) {
    return {
      winnerId: null,
      reason: 'No variant met the promotion bar (>5% better avg AND no case regressed by >1).',
      baselineAvg: baseline.avgQuality,
      baselineMin: baseline.minScore,
      perVariantAnalysis,
    }
  }
  eligibleVariants.sort((a, b) => b.avgQuality - a.avgQuality)
  const winner = eligibleVariants[0]
  return {
    winnerId: winner.variantId,
    reason: `Promoted "${winner.variantId}": avg ${winner.avgQuality.toFixed(2)} vs baseline ${baseline.avgQuality.toFixed(2)}.`,
    baselineAvg: baseline.avgQuality,
    baselineMin: baseline.minScore,
    bestVariant: winner,
    perVariantAnalysis,
  }
}

// ── Promotion side effects ───────────────────────────────────

function promote(stage: Stage, winner: VariantResult, baseline: VariantResult, decision: PromotionDecision, dryRun: boolean) {
  const sourceRel = STAGE_SOURCE[stage]
  const sourceAbs = resolve(process.cwd(), sourceRel)
  const original = readFileSync(sourceAbs, 'utf8')
  const updated = replacePromptInSource(original, winner.prompt)

  // Quick sanity: the regex must have matched; verify by re-extracting.
  try {
    const reExtracted = extractPrompt(updated).prompt
    if (reExtracted.trim() !== winner.prompt.trim()) {
      throw new Error('Prompt round-trip mismatch — refusing to write.')
    }
  } catch (e) {
    throw new Error(`Refusing to write source file: ${(e as Error).message}`)
  }

  if (dryRun) {
    console.log(`[dry-run] Would write ${sourceRel} and commit.`)
    return
  }

  writeFileSync(sourceAbs, updated, 'utf8')

  // JOURNAL.md entry — prepend so the most recent entry is on top.
  const journalPath = resolve(process.cwd(), 'JOURNAL.md')
  const date = new Date().toISOString().slice(0, 10)
  const header = existsSync(journalPath)
    ? readFileSync(journalPath, 'utf8')
    : '# JOURNAL\n\nAutomated entries from `scripts/optimize-prompt.ts` and other agents.\n\n---\n\n'
  const entry = `## ${date} · prompt-optimizer · ${stage}

Promoted variant **${winner.variantId}** (${winner.label}).

| metric | baseline | winner | delta |
|---|---|---|---|
| avg quality | ${baseline.avgQuality.toFixed(2)} | ${winner.avgQuality.toFixed(2)} | ${(winner.avgQuality - baseline.avgQuality >= 0 ? '+' : '') + (winner.avgQuality - baseline.avgQuality).toFixed(2)} |
| min case score | ${baseline.minScore.toFixed(2)} | ${winner.minScore.toFixed(2)} | ${(winner.minScore - baseline.minScore >= 0 ? '+' : '') + (winner.minScore - baseline.minScore).toFixed(2)} |
| pass rate | ${(baseline.passRate * 100).toFixed(0)}% | ${(winner.passRate * 100).toFixed(0)}% | ${((winner.passRate - baseline.passRate) * 100).toFixed(0)}pp |

${decision.reason}

Per-variant table:
${decision.perVariantAnalysis.map((p) => `- ${p.id}: avg=${p.avg.toFixed(2)} (${p.deltaPct >= 0 ? '+' : ''}${p.deltaPct}%), worst-case Δ=${p.worstRegression >= 0 ? '+' : ''}${p.worstRegression}, eligible=${p.eligible}${p.eligible ? '' : ' — ' + p.reason}`).join('\n')}

---

`
  // Insert new entry after the header section but before any prior entries.
  const splitMarker = '---\n\n'
  const idx = header.indexOf(splitMarker)
  const newJournal = idx >= 0
    ? header.slice(0, idx + splitMarker.length) + entry + header.slice(idx + splitMarker.length)
    : header + entry
  writeFileSync(journalPath, newJournal, 'utf8')

  // Git commit. We let this throw if git isn't initialized — calling
  // code in main() catches and surfaces the error.
  try {
    execSync(`git add ${JSON.stringify(sourceRel)} JOURNAL.md`, { stdio: 'pipe' })
    const msg =
      `prompt-optimizer: promote "${winner.variantId}" for ${stage}\n\n` +
      `avg quality ${baseline.avgQuality.toFixed(2)} → ${winner.avgQuality.toFixed(2)} ` +
      `(${(((winner.avgQuality - baseline.avgQuality) / Math.max(baseline.avgQuality, 0.01)) * 100).toFixed(1)}%), ` +
      `min ${baseline.minScore.toFixed(2)} → ${winner.minScore.toFixed(2)}, ` +
      `pass ${(baseline.passRate * 100).toFixed(0)}% → ${(winner.passRate * 100).toFixed(0)}%.\n\n` +
      `Strategy: ${winner.label}.`
    execSync(`git commit -m ${JSON.stringify(msg)}`, { stdio: 'pipe' })
  } catch (e) {
    console.warn(`  [warn] git commit failed: ${(e as Error).message.slice(0, 200)}`)
    console.warn('  Source file and JOURNAL.md were updated; commit manually.')
  }
}

// ── Supabase logging ─────────────────────────────────────────

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.warn('  [warn] Supabase URL / service key missing — skipping audit log.')
    return null
  }
  return createClient(url, key)
}

interface AuditRow {
  round_id: string
  stage: Stage
  variant_id: string
  strategy: string
  prompt_text: string
  prompt_sha: string
  per_case_scores: CaseScore[]
  cases_run: number
  avg_quality: number
  min_case_score: number
  pass_rate: number
  baseline_avg_quality: number | null
  avg_quality_delta_pct: number | null
  worst_case_regression: number | null
  promoted: boolean
  promotion_blocked_reason: string | null
  cost_usd: number
  eval_model: string
  generation_model: string | null
  notes: string | null
}

async function logToTable(rows: AuditRow[]) {
  const sb = supa()
  if (!sb) return
  const { error } = await sb.from('agent_prompt_runs').insert(rows)
  if (error) {
    console.warn(`  [warn] agent_prompt_runs insert failed: ${error.message}`)
  } else {
    console.log(`  audit: ${rows.length} rows written to agent_prompt_runs`)
  }
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  const { stage, dryRun, cap } = parseArgs(process.argv)
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set in .env.local'); process.exit(1)
  }

  const sourceRel = STAGE_SOURCE[stage]
  const sourceAbs = resolve(process.cwd(), sourceRel)
  const sourceText = readFileSync(sourceAbs, 'utf8')
  const { prompt: currentPrompt } = extractPrompt(sourceText)

  const meter = new CostMeter(cap)
  const roundId = randomUUID()

  console.log(`\n══ Prompt Optimizer · stage=${stage} · cap=$${cap.toFixed(2)} ${dryRun ? '· dry-run' : ''}══`)
  console.log(`Source:  ${sourceRel}`)
  console.log(`Prompt:  ${currentPrompt.length} chars, sha=${sha256(currentPrompt).slice(0, 12)}`)
  console.log(`Round:   ${roundId}\n`)

  // 1. Baseline.
  console.log(`[1/4] Running baseline (${QUERIES.length} queries)…`)
  let baselineCache: QueryCache[]
  let baselineResult: VariantResult
  try {
    baselineCache = await runBaseline(meter)
    const baselineCases: CaseScore[] = baselineCache.map((c) => ({
      query: c.query,
      qualityScore: c.evaluation.qualityScore,
      pass: c.evaluation.pass,
      costUsd: 0,
    }))
    const sum = summarize(baselineCases)
    baselineResult = {
      variantId: 'baseline', label: 'baseline', prompt: currentPrompt,
      cases: baselineCases, avgQuality: sum.avg, minScore: sum.min, passRate: sum.passRate,
      totalCost: meter.total,
    }
    console.log(`  → avg=${sum.avg.toFixed(2)} min=${sum.min.toFixed(2)} pass=${(sum.passRate * 100).toFixed(0)}% · cost so far $${meter.total.toFixed(4)}`)
  } catch (e) {
    if (e instanceof CostExceededError) {
      console.error(`\n[abort] ${e.message}`)
      process.exit(3)
    }
    throw e
  }

  // 2. Variants from Sonnet.
  console.log(`\n[2/4] Generating 4 variants via ${SONNET_MODEL}…`)
  let variants: Variant[]
  try {
    const { variants: vs, usage } = await generateVariants(stage, currentPrompt)
    meter.add(usage); meter.check('generate')
    variants = vs
    console.log(`  → ${variants.length} variants, ${variants.map((v) => `${v.id}=${v.prompt.length}c`).join(' · ')} · cost $${meter.total.toFixed(4)}`)
  } catch (e) {
    if (e instanceof CostExceededError) {
      console.error(`\n[abort] ${e.message}`)
      process.exit(3)
    }
    console.error(`Variant generation failed: ${(e as Error).message}`)
    process.exit(1)
  }

  // 3. Eval each variant.
  console.log(`\n[3/4] Evaluating variants…`)
  const variantResults: VariantResult[] = []
  for (const v of variants) {
    console.log(`  variant=${v.id}`)
    try {
      const startingCost = meter.total
      const cases = await runVariantForStage(stage, v.prompt, baselineCache, meter)
      const sum = summarize(cases)
      variantResults.push({
        variantId: v.id, label: v.label, prompt: v.prompt,
        cases, avgQuality: sum.avg, minScore: sum.min, passRate: sum.passRate,
        totalCost: meter.total - startingCost,
      })
      console.log(`    avg=${sum.avg.toFixed(2)} min=${sum.min.toFixed(2)} pass=${(sum.passRate * 100).toFixed(0)}% · variant cost $${(meter.total - startingCost).toFixed(4)} · running $${meter.total.toFixed(4)}`)
    } catch (e) {
      if (e instanceof CostExceededError) {
        console.error(`  [abort mid-variant] ${e.message}`)
        // Continue to write whatever we have — partial variantResults is honest.
        break
      }
      console.warn(`    [warn] variant ${v.id} failed: ${(e as Error).message.slice(0, 200)}`)
    }
  }

  // 4. Decide + (maybe) promote + audit.
  console.log(`\n[4/4] Decision`)
  const decision = decide(baselineResult, variantResults)
  console.log(`  ${decision.reason}`)
  for (const a of decision.perVariantAnalysis) {
    console.log(`  - ${a.id}: avg=${a.avg.toFixed(2)} (${a.deltaPct >= 0 ? '+' : ''}${a.deltaPct}%), worst-case Δ=${a.worstRegression >= 0 ? '+' : ''}${a.worstRegression} → ${a.eligible ? 'ELIGIBLE' : a.reason}`)
  }

  if (decision.bestVariant) {
    console.log(`\n  Promoting "${decision.bestVariant.variantId}"…`)
    try {
      promote(stage, decision.bestVariant, baselineResult, decision, dryRun)
      if (!dryRun) console.log(`  ✓ source updated, JOURNAL.md appended, git commit attempted`)
    } catch (e) {
      console.error(`  [error] promote failed: ${(e as Error).message}`)
    }
  } else {
    console.log(`  No promotion. Current prompt retained.`)
  }

  // Audit rows.
  const rows: AuditRow[] = []
  // Baseline row
  rows.push({
    round_id: roundId, stage, variant_id: 'baseline', strategy: 'baseline',
    prompt_text: currentPrompt, prompt_sha: sha256(currentPrompt),
    per_case_scores: baselineResult.cases,
    cases_run: baselineResult.cases.length,
    avg_quality: baselineResult.avgQuality, min_case_score: baselineResult.minScore,
    pass_rate: baselineResult.passRate,
    baseline_avg_quality: null, avg_quality_delta_pct: null, worst_case_regression: null,
    promoted: false, promotion_blocked_reason: null,
    cost_usd: 0, eval_model: HAIKU_MODEL, generation_model: null,
    notes: null,
  })
  for (const v of variantResults) {
    const a = decision.perVariantAnalysis.find((p) => p.id === v.variantId)
    rows.push({
      round_id: roundId, stage, variant_id: v.variantId,
      strategy: STRATEGIES.find((s) => s.id === v.variantId)?.label ?? v.variantId,
      prompt_text: v.prompt, prompt_sha: sha256(v.prompt),
      per_case_scores: v.cases, cases_run: v.cases.length,
      avg_quality: v.avgQuality, min_case_score: v.minScore, pass_rate: v.passRate,
      baseline_avg_quality: baselineResult.avgQuality,
      avg_quality_delta_pct: a?.deltaPct ?? null,
      worst_case_regression: a?.worstRegression ?? null,
      promoted: decision.winnerId === v.variantId,
      promotion_blocked_reason: a?.eligible ? null : a?.reason ?? null,
      cost_usd: v.totalCost,
      eval_model: HAIKU_MODEL, generation_model: SONNET_MODEL,
      notes: null,
    })
  }
  await logToTable(rows)

  console.log(`\n══ Done. Round cost: $${meter.total.toFixed(4)} ══\n`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
