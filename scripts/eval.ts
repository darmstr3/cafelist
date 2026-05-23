// ─────────────────────────────────────────────────────────────
// scripts/eval.ts
//
// End-to-end evaluation harness for the /labs agent pipeline,
// persisted to Supabase so the /labs/eval dashboard can plot
// quality / cost / latency over time and diff traces between runs.
//
// Pipeline:
//   1. Load fixtures/labs-eval-cases.json
//   2. Upsert cases into agent_eval_cases (retired_at handled for
//      cases that disappear from the fixture file)
//   3. Insert a fresh agent_eval_runs row with git_sha + prompt hashes
//   4. For each case:
//        parseIntent → retrieveCafes → scoreCandidates →
//        writeRecommendation → runDeterministicChecks →
//        evaluate (judge) IFF deterministic passed
//      Write one agent_eval_results row with the full AgentRun trace
//   5. Update the run row with totals (pass count, avg quality, cost)
//
// Cost target: ~$0.05 per full run. Uses Haiku throughout.
//
// Run:  npm run eval                 (all 25 fixtures)
//       npm run eval -- --filter=adversarial
//       npm run eval -- --limit=5
// ─────────────────────────────────────────────────────────────

import { execSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ── Sandbox / proxy setup ─────────────────────────────────
// When running inside the workspace shell, Node's fetch goes
// through a MITM-style HTTPS proxy with a self-signed cert.
// Node's built-in fetch uses its bundled undici and ignores
// setGlobalDispatcher from a separately-installed undici, so we
// swap globalThis.fetch with the npm undici's fetch and configure
// its dispatcher to trust the proxy's cert. No effect outside the
// sandbox (HTTPS_PROXY unset) and the npm-installed undici is
// optional — we skip silently if it isn't present.
const _proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy
if (_proxyUrl) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const undici = require('undici')
    const dispatcher = new undici.ProxyAgent({
      uri: _proxyUrl,
      requestTls: { rejectUnauthorized: false },
      proxyTls: { rejectUnauthorized: false },
    })
    undici.setGlobalDispatcher(dispatcher)
    // Replace native fetch so Node uses the npm undici (which honors
    // the dispatcher we just set) instead of the bundled one.
    ;(globalThis as { fetch: typeof fetch }).fetch = undici.fetch as typeof fetch
  } catch {
    // undici not installed — assume the environment is fine.
  }
}

// ── .env.local loader ───────────────────────────────────────
function loadDotenv(path: string) {
  try {
    const raw = readFileSync(path, 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      if (process.env[m[1]] === undefined) {
        let val = m[2]
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1)
        }
        process.env[m[1]] = val
      }
    }
  } catch {
    /* fine if missing */
  }
}
loadDotenv(resolve(process.cwd(), '.env.local'))

// Late imports so env vars are set first.
import { createClient } from '@supabase/supabase-js'
import { parseIntent } from '../src/lib/labs/intent-parser'
import { SYSTEM_PROMPT as INTENT_PROMPT } from '../src/lib/labs/intent-parser'
import { retrieveCafes } from '../src/lib/labs/retriever'
import { scoreCandidates } from '../src/lib/labs/fit-scorer'
import { writeRecommendation } from '../src/lib/labs/recommender'
import { SYSTEM_PROMPT as RECOMMENDER_PROMPT } from '../src/lib/labs/recommender'
import { evaluate } from '../src/lib/labs/evaluator'
import { SYSTEM_PROMPT as EVALUATOR_PROMPT } from '../src/lib/labs/evaluator'
import { Tracer } from '../src/lib/labs/trace'
import {
  runDeterministicChecks,
  type HardConstraints,
} from '../src/lib/labs/eval-checks'
import type {
  AgentRun,
  Evaluation,
  ParsedIntent,
  Recommendation,
} from '../src/lib/labs/types'
import type { Spot } from '../src/types'

// ── Types ────────────────────────────────────────────────────

interface FixtureCase {
  caseId: string
  query: string
  tags?: string[]
  hardConstraints: HardConstraints
}

interface FixtureFile {
  weekday: string
  cases: FixtureCase[]
}

interface CliOpts {
  filter: string | null
  limit: number | null
  note: string | null
}

// ── Constants ────────────────────────────────────────────────

const FIXTURE_PATH = resolve(process.cwd(), 'fixtures/labs-eval-cases.json')
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!SUPABASE_URL || SUPABASE_URL.includes('placeholder')) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL in .env.local')
  process.exit(1)
}
if (!SUPABASE_SERVICE_KEY || SUPABASE_SERVICE_KEY === 'placeholder') {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── CLI ──────────────────────────────────────────────────────

function parseCli(): CliOpts {
  const opts: CliOpts = { filter: null, limit: null, note: null }
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--filter=')) opts.filter = arg.slice('--filter='.length)
    else if (arg.startsWith('--limit=')) opts.limit = Number(arg.slice('--limit='.length))
    else if (arg.startsWith('--note=')) opts.note = arg.slice('--note='.length)
  }
  return opts
}

// ── Prompt hashes & git sha ──────────────────────────────────

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

function gitSha(): string | null {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  const cli = parseCli()
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as FixtureFile
  let cases = fixture.cases

  if (cli.filter) {
    const needle = cli.filter.toLowerCase()
    cases = cases.filter(
      (c) =>
        c.caseId.toLowerCase().includes(needle) ||
        (c.tags ?? []).some((t) => t.toLowerCase().includes(needle))
    )
  }
  if (cli.limit) cases = cases.slice(0, cli.limit)

  if (cases.length === 0) {
    console.error('No cases matched filter/limit')
    process.exit(1)
  }

  const weekday = (fixture.weekday ?? 'thursday') as
    | 'sunday'
    | 'monday'
    | 'tuesday'
    | 'wednesday'
    | 'thursday'
    | 'friday'
    | 'saturday'

  const promptVersions = {
    intent_parser: sha256(INTENT_PROMPT),
    recommender: sha256(RECOMMENDER_PROMPT),
    evaluator: sha256(EVALUATOR_PROMPT),
  }

  console.log('━━━ /labs eval ━━━')
  console.log(`cases:   ${cases.length} (of ${fixture.cases.length} in fixture)`)
  console.log(`weekday: ${weekday}`)
  console.log(`prompts: ${JSON.stringify(promptVersions)}`)
  const sha = gitSha()
  console.log(`git:     ${sha ?? '(no git)'}`)
  console.log('')

  // ── Sync cases into agent_eval_cases ───────────────────────
  await syncCases(fixture.cases)

  // ── Create the run row ─────────────────────────────────────
  const runId = randomUUID()
  const { error: runErr } = await supabase.from('agent_eval_runs').insert({
    run_id: runId,
    started_at: new Date().toISOString(),
    git_sha: sha,
    prompt_versions: promptVersions,
    total_cases: cases.length,
    total_pass: 0,
    avg_quality: 0,
    total_cost_usd: 0,
    note: cli.note,
  })
  if (runErr) {
    console.error('Failed to insert run row:', runErr.message)
    process.exit(1)
  }

  // ── Run cases sequentially ─────────────────────────────────
  let totalPass = 0
  let qualitySum = 0
  let qualityCount = 0
  let totalCost = 0

  for (const [i, c] of cases.entries()) {
    const idx = `[${i + 1}/${cases.length}]`
    process.stdout.write(`${idx} ${c.caseId}… `)
    try {
      const result = await runOneCase(c, weekday)
      totalCost += result.run.totalCostUsd
      if (result.run.evaluation && typeof result.run.evaluation.qualityScore === 'number') {
        qualitySum += result.run.evaluation.qualityScore
        qualityCount += 1
      }
      const passOverall = result.passDeterministic && (result.passJudge ?? true)
      if (passOverall) totalPass += 1

      const { error } = await supabase.from('agent_eval_results').insert({
        run_id: runId,
        case_id: c.caseId,
        pass_deterministic: result.passDeterministic,
        pass_judge: result.passJudge,
        quality_score: result.run.evaluation?.qualityScore ?? null,
        latency_ms: result.run.totalDurationMs,
        cost_usd: result.run.totalCostUsd,
        deterministic_fails: result.deterministicFails,
        full_trace: result.run,
      })
      if (error) {
        console.log(`✗ db-error: ${error.message}`)
      } else {
        const detSym = result.passDeterministic ? '✓' : '✗'
        const judSym =
          result.passJudge == null ? '–' : result.passJudge ? '✓' : '✗'
        const q = result.run.evaluation?.qualityScore ?? null
        console.log(
          `det:${detSym} judge:${judSym} q:${q ?? '—'} $${result.run.totalCostUsd.toFixed(4)} ${result.run.totalDurationMs}ms`
        )
        if (result.deterministicFails.length > 0) {
          console.log(`    failed: ${result.deterministicFails.join(', ')}`)
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.log(`✗ error: ${message}`)
      // Persist the failure so the dashboard reflects it.
      await supabase.from('agent_eval_results').insert({
        run_id: runId,
        case_id: c.caseId,
        pass_deterministic: false,
        pass_judge: null,
        quality_score: null,
        latency_ms: 0,
        cost_usd: 0,
        deterministic_fails: ['fatal_error'],
        full_trace: { fatal: true, fatalMessage: message },
      })
    }
  }

  const avgQuality = qualityCount > 0 ? qualitySum / qualityCount : 0
  await supabase
    .from('agent_eval_runs')
    .update({
      finished_at: new Date().toISOString(),
      total_pass: totalPass,
      avg_quality: Number(avgQuality.toFixed(2)),
      total_cost_usd: Number(totalCost.toFixed(6)),
    })
    .eq('run_id', runId)

  console.log('')
  console.log('━━━ summary ━━━')
  console.log(`pass:    ${totalPass} / ${cases.length}`)
  console.log(`quality: ${avgQuality.toFixed(2)} (avg of ${qualityCount} judged cases)`)
  console.log(`cost:    $${totalCost.toFixed(4)}`)
  console.log(`run_id:  ${runId}`)
  console.log('')
  console.log('Open /labs/eval to view this run.')
}

// ── Per-case runner ──────────────────────────────────────────

interface CaseResult {
  passDeterministic: boolean
  passJudge: boolean | null
  deterministicFails: string[]
  run: AgentRun
}

async function runOneCase(
  c: FixtureCase,
  weekday: 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday'
): Promise<CaseResult> {
  const tracer = new Tracer()
  let recommendation: Recommendation | null = null
  let evaluation: Evaluation | null = null
  let topPick: Spot | null = null

  try {
    // 1. Parse intent
    const intent: ParsedIntent = await tracer.span('intent_parser', async (ctx) => {
      const { intent, usage } = await parseIntent(c.query)
      ctx.setLlmUsage(usage)
      return intent
    })

    // 2. Retrieve candidates
    const retrieval = await tracer.span('retriever', async () => retrieveCafes(intent))

    if (retrieval.candidates.length === 0) {
      // No candidates — the deterministic check will fail on minPicks
      // but we still finalize so the trace lands.
      const run = tracer.finalize({
        query: c.query,
        recommendation: null,
        evaluation: null,
        fatal: { message: 'No candidate cafes found' },
      })
      const det = runDeterministicChecks({
        recommendation: null,
        topPick: null,
        constraints: c.hardConstraints,
        weekday,
      })
      return {
        passDeterministic: det.pass,
        passJudge: null,
        deterministicFails: det.failed,
        run,
      }
    }

    // 3. Score fit
    const scored = await tracer.span('fit_scorer', async () =>
      scoreCandidates(intent, retrieval.candidates)
    )

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

    // Resolve the top pick to a real Spot for deterministic checks.
    if (recommendation.picks.length > 0) {
      const topId = recommendation.picks[0].spotId
      topPick = retrieval.candidates.find((s) => s.id === topId) ?? null
    }

    // 5. Deterministic checks BEFORE the judge — so we don't pay
    //    Haiku to evaluate obvious failures.
    const det = runDeterministicChecks({
      recommendation,
      topPick,
      constraints: c.hardConstraints,
      weekday,
    })

    let passJudge: boolean | null = null
    if (det.pass) {
      // 6. Judge (only when deterministic passed)
      evaluation = await tracer.span('evaluator', async (ctx) => {
        const { evaluation, usage } = await evaluate({
          originalQuery: c.query,
          intent,
          recommendation: recommendation!,
        })
        ctx.setLlmUsage(usage)
        return evaluation
      })
      passJudge = evaluation.pass
    }

    const run = tracer.finalize({
      query: c.query,
      recommendation,
      evaluation,
    })

    return {
      passDeterministic: det.pass,
      passJudge,
      deterministicFails: det.failed,
      run,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const run = tracer.finalize({
      query: c.query,
      recommendation,
      evaluation,
      fatal: { message },
    })
    return {
      passDeterministic: false,
      passJudge: null,
      deterministicFails: ['pipeline_error'],
      run,
    }
  }
}

// ── Case sync (upsert + soft-retire missing) ─────────────────

async function syncCases(cases: FixtureCase[]) {
  // Upsert each case
  const rows = cases.map((c) => ({
    case_id: c.caseId,
    query: c.query,
    hard_constraints: c.hardConstraints,
    tags: c.tags ?? [],
    retired_at: null,
  }))
  const { error: upErr } = await supabase
    .from('agent_eval_cases')
    .upsert(rows, { onConflict: 'case_id' })
  if (upErr) {
    console.error('Failed to upsert cases:', upErr.message)
    process.exit(1)
  }

  // Soft-retire cases that no longer appear in the fixture file
  const activeIds = new Set(cases.map((c) => c.caseId))
  const { data: existing } = await supabase
    .from('agent_eval_cases')
    .select('case_id')
    .is('retired_at', null)
  if (existing) {
    const stale = existing.map((r) => r.case_id).filter((id) => !activeIds.has(id))
    if (stale.length > 0) {
      await supabase
        .from('agent_eval_cases')
        .update({ retired_at: new Date().toISOString() })
        .in('case_id', stale)
      console.log(`Retired ${stale.length} stale case(s): ${stale.join(', ')}`)
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
