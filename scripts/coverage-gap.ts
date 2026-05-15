// ─────────────────────────────────────────────────────────────
// scripts/coverage-gap.ts
//
// Coverage Gap Agent.
//
// Goal: turn real /labs user query patterns into Scout's
// prioritisation signal, so acquisition stops being driven by a
// hardcoded seed list and starts being driven by demand.
//
// Pipeline:
//   1. Read the last 7 days of agent_query_logs.
//   2. Group by (city, neighborhood); per group compute:
//        - query_count
//        - avg quality_score (evaluator 0–10)
//        - fraction of runs with picks_count < 3 (thin-result rate)
//        - dominant failure_mode
//   3. Rank by demand × quality-gap:
//        priority_score = log10(1 + queryCount) * (10 - avgQuality)
//                         * (1 + thinResultRate)
//                         * COVERAGE_GAP_WEIGHT
//      The weight is set so a real-demand entry comfortably beats a
//      hardcoded seed (seed priority_score values cluster ~1–5).
//   4. Upsert the top 20 into scout_priority with
//      source='coverage_gap', expires_at = now + 30d, full metadata
//      payload (query_count, avg_quality, sample queries, etc.).
//   5. Write reports/coverage-gap-YYYY-MM-DD.md with the ranked
//      table, methodology, and failure-mode breakdown.
//
// Run:  npx tsx scripts/coverage-gap.ts
// Flags:
//   --dry-run     Don't write to scout_priority or report file
//   --days=N      Override the 7-day lookback window
//   --top=N       Override the top-20 cutoff
// ─────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

// ── Args ─────────────────────────────────────────────────────
const isDryRun = process.argv.includes('--dry-run')
const daysArg = process.argv.find((a) => a.startsWith('--days='))
const topArg = process.argv.find((a) => a.startsWith('--top='))
const LOOKBACK_DAYS = daysArg ? parseInt(daysArg.split('=')[1], 10) : 7
const TOP_N = topArg ? parseInt(topArg.split('=')[1], 10) : 20

// ── Config ───────────────────────────────────────────────────
// Coverage-gap entries must beat hardcoded seeds. Seeds in the
// scout queue cluster 80–100 (manual curation), so we multiply by
// 100 — even a marginal demand signal (1 query, no quality data)
// lands at ~300, comfortably above the highest seed.
const COVERAGE_GAP_WEIGHT = 100
const EXPIRY_DAYS = 30

// ── Env loading (mirrors scripts/import-nyc.ts) ──────────────
function loadEnv() {
  try {
    const raw = fs.readFileSync('.env.local', 'utf-8')
    for (const line of raw.split('\n')) {
      const [key, ...val] = line.split('=')
      if (key && !key.startsWith('#') && key.trim()) {
        process.env[key.trim()] = val.join('=').trim()
      }
    }
  } catch {
    // .env.local missing — fall back to ambient env
  }
}
loadEnv()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!SUPABASE_URL || SUPABASE_URL.includes('placeholder') ||
    !SUPABASE_SERVICE_KEY || SUPABASE_SERVICE_KEY.includes('placeholder')) {
  console.error('✖ Missing Supabase credentials in .env.local')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ── Types ────────────────────────────────────────────────────
interface LogRow {
  query: string
  city: string | null
  neighborhood: string | null
  picks_count: number
  quality_score: number | null
  failure_mode: string | null
  created_at: string
}

interface Group {
  city: string
  neighborhood: string | null
  queryCount: number
  qualityScores: number[]
  thinResultCount: number
  failureCounts: Map<string, number>
  sampleQueries: string[]
}

interface Ranked {
  city: string
  neighborhood: string | null
  queryCount: number
  avgQuality: number | null
  thinResultRate: number
  dominantFailureMode: string
  priorityScore: number
  sampleQueries: string[]
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  console.log(
    `Coverage Gap Agent — reading logs since ${since.toISOString()} ` +
    `(last ${LOOKBACK_DAYS}d)`
  )

  // 1. Read logs ─────────────────────────────────────────────
  const { data, error } = await db
    .from('agent_query_logs')
    .select('query, city, neighborhood, picks_count, quality_score, failure_mode, created_at')
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(10_000)

  if (error) {
    console.error('✖ Failed to read agent_query_logs:', error.message)
    process.exit(1)
  }

  const logs = (data ?? []) as LogRow[]
  console.log(`  → ${logs.length} log rows`)

  // 2. Group + aggregate ─────────────────────────────────────
  const groups = new Map<string, Group>()
  for (const row of logs) {
    if (!row.city) continue // skip un-geo-located runs
    const key = `${row.city}|${row.neighborhood ?? ''}`
    let g = groups.get(key)
    if (!g) {
      g = {
        city: row.city,
        neighborhood: row.neighborhood,
        queryCount: 0,
        qualityScores: [],
        thinResultCount: 0,
        failureCounts: new Map(),
        sampleQueries: [],
      }
      groups.set(key, g)
    }
    g.queryCount += 1
    if (row.quality_score != null) g.qualityScores.push(Number(row.quality_score))
    if (row.picks_count < 3) g.thinResultCount += 1
    const mode = row.failure_mode ?? 'unknown'
    g.failureCounts.set(mode, (g.failureCounts.get(mode) ?? 0) + 1)
    if (g.sampleQueries.length < 3) g.sampleQueries.push(row.query)
  }

  // 3. Rank ──────────────────────────────────────────────────
  const ranked: Ranked[] = []
  for (const g of groups.values()) {
    const avgQuality =
      g.qualityScores.length === 0
        ? null
        : g.qualityScores.reduce((a, b) => a + b, 0) / g.qualityScores.length
    const thinResultRate = g.queryCount === 0 ? 0 : g.thinResultCount / g.queryCount
    // Quality gap: missing scores get treated as max gap (10) because
    // a run with no evaluator output is almost always a failure mode
    // worth investigating.
    const qualityGap = avgQuality == null ? 10 : Math.max(0, 10 - avgQuality)
    const priorityScore =
      Math.log10(1 + g.queryCount) *
      qualityGap *
      (1 + thinResultRate) *
      COVERAGE_GAP_WEIGHT

    // Dominant failure mode = the mode (excluding 'ok') with the
    // most occurrences. If only 'ok' is present, label as 'ok'.
    let dominant: [string, number] = ['ok', 0]
    for (const [mode, count] of g.failureCounts) {
      if (mode === 'ok') continue
      if (count > dominant[1]) dominant = [mode, count]
    }
    if (dominant[1] === 0) dominant = ['ok', g.failureCounts.get('ok') ?? 0]

    ranked.push({
      city: g.city,
      neighborhood: g.neighborhood,
      queryCount: g.queryCount,
      avgQuality,
      thinResultRate,
      dominantFailureMode: dominant[0],
      priorityScore: Number(priorityScore.toFixed(4)),
      sampleQueries: g.sampleQueries,
    })
  }

  ranked.sort((a, b) => b.priorityScore - a.priorityScore)
  const top = ranked.slice(0, TOP_N)

  console.log(`  → ${ranked.length} (city, neighborhood) groups; top ${top.length}:`)
  for (const r of top.slice(0, 10)) {
    console.log(
      `    ${r.priorityScore.toFixed(2).padStart(7)}  ` +
      `${r.city}${r.neighborhood ? ' / ' + r.neighborhood : ''} ` +
      `(${r.queryCount}q, q=${r.avgQuality?.toFixed(1) ?? '-'}, ` +
      `thin=${(r.thinResultRate * 100).toFixed(0)}%, mode=${r.dominantFailureMode})`
    )
  }

  // 4. Write scout_priority ──────────────────────────────────
  if (top.length > 0 && !isDryRun) {
    const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000)
    const rows = top.map((r) => ({
      city: r.city,
      neighborhood: r.neighborhood,
      priority_score: r.priorityScore,
      source: 'coverage_gap',
      expires_at: expiresAt.toISOString(),
      metadata: {
        query_count: r.queryCount,
        avg_quality: r.avgQuality,
        thin_result_rate: r.thinResultRate,
        dominant_failure_mode: r.dominantFailureMode,
        sample_queries: r.sampleQueries,
        computed_at: new Date().toISOString(),
        lookback_days: LOOKBACK_DAYS,
      },
      updated_at: new Date().toISOString(),
    }))

    const { error: upsertErr } = await db
      .from('scout_priority')
      .upsert(rows, { onConflict: 'city,neighborhood,source' })

    if (upsertErr) {
      console.error('✖ Failed to upsert scout_priority:', upsertErr.message)
      // Fall through to the report anyway — partial run is better
      // than no signal at all.
    } else {
      console.log(`  ✓ Upserted ${rows.length} rows into scout_priority`)
    }
  } else if (isDryRun) {
    console.log('  (dry-run — skipping scout_priority upsert)')
  }

  // 5. Write markdown report ─────────────────────────────────
  const today = new Date().toISOString().slice(0, 10)
  const report = renderReport({ since, logs, ranked, top, today })
  const reportDir = path.resolve(process.cwd(), 'reports')
  const reportPath = path.join(reportDir, `coverage-gap-${today}.md`)

  if (!isDryRun) {
    fs.mkdirSync(reportDir, { recursive: true })
    fs.writeFileSync(reportPath, report, 'utf-8')
    console.log(`  ✓ Wrote ${reportPath}`)
  } else {
    console.log(`  (dry-run — would have written ${reportPath})`)
    console.log('---\n' + report)
  }
}

// ── Markdown rendering ───────────────────────────────────────
function renderReport(args: {
  since: Date
  logs: LogRow[]
  ranked: Ranked[]
  top: Ranked[]
  today: string
}): string {
  const { since, logs, ranked, top, today } = args
  const totalGroups = ranked.length

  // Overall failure-mode breakdown
  const failureTotals = new Map<string, number>()
  for (const l of logs) {
    const m = l.failure_mode ?? 'unknown'
    failureTotals.set(m, (failureTotals.get(m) ?? 0) + 1)
  }
  const failureBreakdown = [...failureTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([mode, count]) =>
      `- \`${mode}\` — ${count} (${((count / Math.max(1, logs.length)) * 100).toFixed(0)}%)`
    )
    .join('\n')

  const rows = top
    .map((r, i) => {
      const place = r.neighborhood ? `${r.city} / ${r.neighborhood}` : r.city
      const q = r.avgQuality == null ? '—' : r.avgQuality.toFixed(1)
      return (
        `| ${i + 1} | ${place} | ${r.queryCount} | ${q} | ` +
        `${(r.thinResultRate * 100).toFixed(0)}% | ` +
        `\`${r.dominantFailureMode}\` | ${r.priorityScore.toFixed(2)} |`
      )
    })
    .join('\n')

  const sampleSection = top
    .slice(0, 5)
    .map((r) => {
      const place = r.neighborhood ? `${r.city} / ${r.neighborhood}` : r.city
      const samples = r.sampleQueries
        .map((q) => `  - "${q.replace(/"/g, '\\"')}"`)
        .join('\n')
      return `**${place}**\n${samples}`
    })
    .join('\n\n')

  return `# Coverage Gap Report — ${today}

Generated by \`scripts/coverage-gap.ts\` against \`agent_query_logs\`.

## Window
- **Since:** ${since.toISOString()}
- **Through:** ${new Date().toISOString()}
- **Lookback:** ${LOOKBACK_DAYS} days
- **Total logged runs:** ${logs.length}
- **Distinct (city, neighborhood) groups:** ${totalGroups}

## Method
For each (city, neighborhood) extracted from parsed intent we compute:
- \`query_count\` — demand signal.
- \`avg_quality_score\` — evaluator output, 0–10.
- \`thin_result_rate\` — fraction of runs returning fewer than 3 picks.
- \`dominant_failure_mode\` — most common non-\`ok\` failure mode.

\`\`\`
priority_score = log10(1 + queryCount)
               * max(0, 10 - avgQuality)
               * (1 + thinResultRate)
               * ${COVERAGE_GAP_WEIGHT}    // weight vs hardcoded seeds
\`\`\`

Missing \`avgQuality\` is treated as max gap (10) — a run with no
evaluator output is itself a strong signal something's off.

## Top ${top.length} acquisition priorities

| # | Location | Queries | Avg quality | Thin-result rate | Dominant failure | Priority |
|---|----------|---------|-------------|------------------|------------------|----------|
${rows || '_(no groups in window)_'}

These rows are upserted into \`scout_priority\` with
\`source='coverage_gap'\` and \`expires_at = now + ${EXPIRY_DAYS}d\`, so
Scout's queue refreshes naturally as user demand shifts.

## Failure-mode breakdown (all logged runs)

${failureBreakdown || '_(none)_'}

## Sample queries (top 5 priorities)

${sampleSection || '_(none)_'}
`
}

main().catch((err) => {
  console.error('✖ Unhandled error:', err)
  process.exit(1)
})
