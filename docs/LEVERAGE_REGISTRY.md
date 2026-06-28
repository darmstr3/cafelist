# CafeList Leverage Registry

_Permanent record of how every repeated workflow is handled. Read this before doing any recurring task manually._

Rule: **A repeated task may not be closed until the reusable asset is created or the task is explicitly classified as judgment-dependent.**

---

## Index

| # | Workflow | Status | Owner | Trigger |
|---|---|---|---|---|
| LR-01 | Scout — Café Discovery Loop | Automated / Monitored | Vercel Cron | Every 4h |
| LR-02 | Curator — Workability Scoring Loop | Automated / Monitored | Vercel Cron | Daily 04:03 UTC |
| LR-03 | Enricher — Signal Extraction Loop | Partially Automated | Manual / Scheduled | After Scout; 90-day stale pass |
| LR-04 | Coverage Gap Analysis | Partially Automated | Vercel Cron | Mondays 07:00 UTC |
| LR-05 | Publication Quality Gate | Automated | `npm run cafelist:quality-gate` | Before any publish decision |
| LR-06 | Stale Data Detection | Automated | `npm run cafelist:check-stale` | Weekly or before publish |
| LR-07 | Duplicate Detection | Automated | `npm run cafelist:find-duplicates` | After bulk imports; monthly |
| LR-08 | Manual Review Queue | Documented | Human (Donovan) | Populated by LR-05, LR-06, LR-07 |
| LR-09 | SEO Page Readiness Check | Automated (subset) | `npm run cafelist:quality-gate --seo` | Before any new page |
| LR-10 | Build + Type + Lint Check | Automated | `npm run cafelist:build-check` | Before any merge or deploy |
| LR-11 | Weekly Growth Review | Documented | Human + Template | Fridays |
| LR-12 | Decision Recording | Documented | Human + Template | Per decision/experiment |
| LR-13 | Second-Occurrence Logging | Documented | Human + `ops/logs/` | Per repeated task |
| LR-14 | Neighborhood Expansion Decision | Documented | Human + Quality Gate | When coverage threshold met |
| LR-15 | Eval Harness | Automated | `npm run eval` | Per prompt/scoring change |

---

## LR-01 — Scout: Café Discovery Loop

### Trigger
Vercel Cron fires every 4 hours. Can also be triggered manually via `npm run scout` or `POST /api/scout`.

### Input
`scout_priority` table — ranked list of (city, neighborhood) pairs by priority_score. Coverage Gap agent maintains this table.

### Current Manual Steps
None required in steady state. Setup required: `GOOGLE_PLACES_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, Vercel Cron config in `vercel.json`.

### Reusable System
`scripts/scout.ts` + `src/lib/scout.ts`. Thin script wrapper ensures CLI and API handler share identical logic.

### Verification
- `scout_runs` table records: status (success/partial/cap_hit/error), city, candidates_examined, candidates_inserted, total_cost_usd
- Cost caps enforced: $0.50/run, $3.00/24h
- New spots land in `status='pending'` — not published until Curator + approval

### Human Gate
No gate for discovery. Human (or Curator) must approve before any spot becomes `status='approved'`.

### State
`scout_runs` table (Supabase). `scout_priority` table drives rotation.

### Failure Handling
`error` status written to `scout_runs`. `/admin/ops` surfaces last run status. Cost cap hit → `cap_hit` status → Scout skips next cycle.

### Owner
Vercel Cron (primary). `npm run scout` (manual trigger).

### Status
✅ Automated / Monitored

---

## LR-02 — Curator: Workability Scoring Loop

### Trigger
Vercel Cron daily at 04:03 UTC. Manual: `npm run curate:workability`.

### Input
All `status='approved'` spots where `workability_scored_at IS NULL` OR `workability_scored_at < now() - interval '90 days'`.

### Current Manual Steps
None in steady state. Run `npm run curate:workability --dry-run --limit=5` to preview output before a full pass.

### Reusable System
`scripts/curate-workability.ts`. Idempotent: re-running picks up only unscored/stale rows. Concurrency cap: 2 (to avoid Anthropic Tier 1 rate limits).

### Verification
- workability_score in [0, 10]
- workability_reasoning non-empty (> 10 chars)
- workability_scored_at updated
- `cafelist:quality-gate` checks: score > 9 with no wifi evidence flagged as anomaly

### Human Gate
Spot-check when score changes by > 3 from previous value. `/admin/ops` shows Curator last-run metrics.

### State
`spots.workability_score`, `spots.workability_reasoning`, `spots.workability_scored_at` (Supabase).

### Failure Handling
LLM errors logged with spot ID. Cost cap hit → script exits with non-zero code. Daily run resumes tomorrow.

### Owner
Vercel Cron (primary). Manual for backfill passes.

### Status
✅ Automated / Monitored

---

## LR-03 — Enricher: Signal Extraction Loop

### Trigger
Manual: `npm run enrich`. Should run after each significant Scout batch (≥ 20 new spots). 90-day stale pass.

### Input
`status='approved'` spots where `enriched_at IS NULL` OR `enriched_at < now() - interval '90 days'`. Reads `notes` field (review text from import).

### Current Manual Steps
1. Run `npm run enrich:dry --limit=10` to preview
2. Run `npm run enrich` for full pass
3. Run `npm run curate:workability` after enrichment (richer inputs → better scores)

### Reusable System
`scripts/enrich-spots.ts`. Mines notes for: outlets, wifi quality, noise level, laptop culture, camping tolerance. Writes `enrichment_signals` JSONB + sets `enriched_at`.

### Verification
- `enriched_at` updated
- `enrichment_signals` non-empty
- `enrichment_signals.{field}.confidence` in [0, 1]
- Conflicting signals flagged in `enrichment_signals.{field}.conflicting`

### Human Gate
Required for conflicting signals. `cafelist:quality-gate` surfaces spots with `conflicting: true` in any signal.

### State
`spots.enriched_at`, `spots.enrichment_signals`, `spots.has_outlets`, `spots.noise_level` (Supabase).

### Failure Handling
Per-spot errors logged to console; script continues. Cost cap respected.

### Owner
Manual trigger (Donovan). **TODO:** Add to weekly scheduled task after Scout batch completes.

### Status
Partially Automated — script exists, needs scheduling

---

## LR-04 — Coverage Gap Analysis

### Trigger
Vercel Cron every Monday at 07:00 UTC. Manual: `npm run coverage-gap`.

### Input
`agent_query_logs` table — demand signals from `/labs` queries. Current window: 7 days.

### Current Manual Steps
Report is auto-generated but must be manually reviewed to act on priorities.

### Reusable System
`scripts/coverage-gap.ts`. Computes priority_score per (city, neighborhood). Upserts into `scout_priority`. Writes report to `reports/coverage-gap-YYYY-MM-DD.md`.

### Verification
- `scout_priority` updated with new `source='coverage_gap'` rows
- Report written with correct date window
- Anomalies section identifies known issues (e.g., zero logs in window)

### Human Gate
Yes — review report before acting on priorities. Scout queue can be overridden manually in `scout_priority`.

### State
`scout_priority` table (Supabase). `reports/` directory.

### Failure Handling
Known issue: `coverage_gap` upsert fails on (city, neighborhood) collision with other sources. Bug documented in memory. Workaround: `scout_priority` unique index on (city, neighborhood) — new coverage_gap rows only if not already present.

### Owner
Vercel Cron (primary). Manual for ad-hoc runs.

### Status
Partially Automated / Monitored

---

## LR-05 — Publication Quality Gate

### Trigger
`npm run cafelist:quality-gate`. Run before any publish decision, after Curator pass, or before creating an SEO page.

### Input
All `status='approved'` spots in Supabase (or `--spot=<id>` for single-spot check).

### Current Manual Steps
Previously: manual inspection of Supabase against QUALITY_BAR.md thresholds. Now replaced by this script.

### Reusable System
`scripts/cafelist-quality-gate.ts`. Checks per spot:
- Required fields present (name, address, city, lat/lng, workability_score)
- workability_score ≥ 6 for retriever eligibility
- Outlet claims backed by enrichment (enriched_at + confidence ≥ 0.6)
- Hours structured when hours claims are made
- Freshness (workability_scored_at within 90d; last_verified_at within 180d)
- Coordinate validity (lat/lng in range, not 0,0)
- Hours format parseable
- Anomaly detection (score > 9 with no wifi evidence)

Outputs per-spot verdict: `publish` / `hold` / `review` / `reject`.

Writes results to `ops/reports/quality-gate-YYYY-MM-DD.json` and summary to stdout.

### Verification
Script output is the verification. Checker is independent of Curator (separate logic, reads same DB).

### Human Gate
`review` verdicts require human decision. `hold` verdicts identify what enrichment would unblock publication. `reject` verdicts require human confirmation before acting.

### State
`ops/reports/quality-gate-YYYY-MM-DD.json`. `ops/queues/manual-review.json` (append-only for `review` verdicts).

### Failure Handling
Script exits with code 1 if Supabase connection fails. Individual spot errors logged; script continues.

### Owner
Manual (Donovan). Runs before publish decisions.

### Status
✅ Implemented

---

## LR-06 — Stale Data Detection

### Trigger
`npm run cafelist:check-stale`. Run weekly or before any data quality work.

### Input
All spots in Supabase. Staleness thresholds: workability_scored_at > 90d, enriched_at > 90d, last_verified_at > 180d.

### Current Manual Steps
Previously: manual Supabase queries. Now replaced by this script.

### Reusable System
`scripts/cafelist-check-stale.ts`. Categorizes spots by:
- `needs_enrichment`: enriched_at IS NULL or > 90d
- `needs_curation`: workability_scored_at IS NULL or > 90d
- `needs_verification`: last_verified_at IS NULL or > 180d
- `missing_fields`: required fields null
- `seo_at_risk`: featured on pages with stale data

Writes to `ops/queues/manual-review.json` and summary report.

### Verification
Timestamp comparison is deterministic. Cross-checks with quality gate.

### Human Gate
Detection is automatic. Deciding which stale spots to re-enrich vs. retire requires human judgment.

### State
`ops/queues/manual-review.json`. `ops/reports/stale-check-YYYY-MM-DD.json`.

### Failure Handling
Script exits with code 1 on DB connection failure. Results are read-only — no mutations.

### Owner
Manual weekly trigger (Donovan).

### Status
✅ Implemented

---

## LR-07 — Duplicate Detection

### Trigger
`npm run cafelist:find-duplicates`. Run after every bulk import and monthly.

### Input
All spots in Supabase. Compares: normalized name, google_place_id, coordinates (within ~50m).

### Current Manual Steps
Previously: none (not done). Now replaced by this script.

### Reusable System
`scripts/cafelist-find-duplicates.ts`. Three-pass detection:
1. Exact google_place_id match (definite duplicate)
2. Normalized name match within same city (likely duplicate)
3. Coordinate proximity < 0.0005 degrees (~50m) with similar name (possible duplicate)

Writes candidate groups to `ops/queues/duplicate-candidates.json` with confidence level.

### Verification
No automatic merges. Script is read-only. Human reviews candidates before any action.

### Human Gate
**Always required.** No merge without human approval. Rule: chain locations in same city are NOT duplicates even if names match.

### State
`ops/queues/duplicate-candidates.json`. Append-only; add `resolved_at` field when acted on.

### Failure Handling
Script exits with code 1 on DB failure. Threshold tunable via flags.

### Owner
Manual (Donovan). Post-import and monthly.

### Status
✅ Implemented

---

## LR-08 — Manual Review Queue

### Trigger
Populated by: quality gate (`review` verdicts), stale check (`needs_verification`), duplicate finder (all candidates), enricher (conflicting signals).

### Input
JSON objects written by automated scripts to `ops/queues/`.

### Current Manual Steps
1. Run relevant detection scripts
2. Review `ops/queues/manual-review.json` and `ops/queues/duplicate-candidates.json`
3. For each item: approve / reject / defer / edit in Supabase
4. Mark item resolved in queue file (add `resolved_at`, `resolution`, `resolved_by`)

### Reusable System
Queue files at `ops/queues/`. Format standardized across all writers.

### Verification
Each queue item includes: why_flagged, evidence, severity, recommended_action, source_freshness.

### Human Gate
This IS the human gate for all automated pipelines.

### State
`ops/queues/manual-review.json`, `ops/queues/duplicate-candidates.json`, `ops/queues/content-review.json`.

### Failure Handling
Queue items persist until explicitly resolved. Nothing is auto-deleted.

### Owner
Donovan (reviewer). Automated scripts (writers).

### Status
✅ Documented / Partially Implemented

---

## LR-09 — SEO Page Readiness Check

### Trigger
`npm run cafelist:quality-gate --seo` before creating any new neighborhood or category page.

### Input
Neighborhood name + all approved spots in that neighborhood.

### Current Manual Steps
Previously: manual check against SEO_RULES.md. Now automated via quality gate.

### Reusable System
Quality gate with `--seo` flag checks all 5 SEO_RULES.md conditions:
- ≥ 3 spots with workability ≥ 6, status=approved
- 0 featured spots with unverified key attributes
- All featured spots with hours claims have structured hours
- All featured spots verified within 180 days
- Not duplicative of existing page (> 50% same spot list)

Output: READY / ON HOLD / BLOCKED per SEO_RULES.md vocabulary.

### Verification
Quality gate output is the verification. Separate from the human writing the page.

### Human Gate
Yes — human writes the page. Quality gate determines if it's ready to be written at all.

### State
Quality gate report. `ops/state/seo-state.json` tracks page statuses.

### Failure Handling
Quality gate returns non-zero exit if BLOCKED. CI can gate on this.

### Owner
Manual (Donovan). Run before any new page.

### Status
Automated (checks) + Manual (page creation)

---

## LR-10 — Build + Type + Lint Check

### Trigger
`npm run cafelist:build-check` (wraps: eslint + tsc --noEmit + next build). Also runs in CI on every PR.

### Input
Current repository state.

### Current Manual Steps
Previously: running checks manually before pushing. Now: single command + CI.

### Reusable System
`cafelist:build-check` script in `package.json` + `.github/workflows/ci.yml`.

### Verification
Zero lint errors. Zero TypeScript errors. Build succeeds.

### Human Gate
CI blocks merge if failing.

### State
GitHub Actions CI status (green/red). No local state file.

### Failure Handling
Script exits non-zero. Error output to stdout. CI blocks merge.

### Owner
Automated (CI). Manual for local pre-push check.

### Status
✅ Automated (CI)

---

## LR-11 — Weekly Growth Review

### Trigger
Every Friday. Template at `ops/reports/weekly-growth.md`.

### Input
- Git log for the week
- `/admin/ops` agent telemetry
- Coverage gap report
- Quality gate output (if run this week)
- Stale check output (if run this week)

### Current Manual Steps
1. Open `ops/reports/weekly-growth.md`
2. Fill in the template: traffic changes, search queries, agent health, data freshness, recommendations added/removed, broken experiences, SEO opportunities
3. Identify top 3 priorities for next week (max 3)
4. Update `ops/state/current-priority.md`

### Reusable System
Template at `ops/reports/weekly-growth.md`. Saved reports at `ops/reports/weekly-YYYY-MM-DD.md`.

### Verification
Report includes: ≤ 3 priorities, each with a "why this matters" line.

### Human Gate
This IS a human activity — the loop exists to prevent skipping the review.

### State
`ops/reports/weekly-YYYY-MM-DD.md`. `ops/state/current-priority.md` (updated each Friday).

### Failure Handling
If review is skipped, run it the following Monday. Do not carry two weeks of priorities forward without explicit deprioritization.

### Owner
Donovan.

### Status
Documented — implement cadence when Labs V2 ships

---

## LR-12 — Decision Recording

### Trigger
Any significant design/architecture/experiment decision. Rule: experiment repeated a second time requires explaining what changed.

### Input
Decision, alternatives, rationale, expected outcome, actual outcome (if retrospective).

### Current Manual Steps
1. Check `DECISION_LOG.md` and `docs/DECISION_LOG.md` — has a similar decision been made before?
2. If it's an architecture/product decision: add ADR to root `DECISION_LOG.md`
3. If it's an operational/experiment decision: add entry to `docs/DECISION_LOG.md`

### Reusable System
ADR template in `LABS_V2_PLAN.md §11`. Operations decision template in `docs/DECISION_LOG.md`.

### Verification
Log entry cites alternatives considered. Outcome recorded (not just intent).

### Human Gate
N/A — this is itself the human gate.

### State
`DECISION_LOG.md` (ADRs), `docs/DECISION_LOG.md` (operations decisions).

### Failure Handling
If decision is not recorded: the next person (future Donovan or agent) will repeat the same reasoning. This is waste.

### Owner
Donovan.

### Status
Documented

---

## LR-13 — Second-Occurrence Logging

### Trigger
Any task performed for the second or more time. Append an entry to `ops/logs/automation-runs.jsonl`.

### Input
Task name, date, related files, whether a reusable asset exists, next action.

### Current Manual Steps
After completing any non-trivial task: check the log for prior occurrences. If this is the second occurrence and no reusable asset exists: the task is not "done" until the asset is created or documented as judgment-dependent.

### Reusable System
`ops/logs/automation-runs.jsonl` (append-only). See schema below.

```json
{
  "task": "string",
  "date": "YYYY-MM-DD",
  "occurrence_count": 1,
  "related_files": ["scripts/..."],
  "reusable_asset": "npm run cafelist:quality-gate" | null,
  "status": "DONE" | "AUTOMATION_REQUIRED" | "JUDGMENT_REQUIRED",
  "notes": "optional"
}
```

### Verification
If `occurrence_count >= 2` AND `reusable_asset` is null AND `status != "JUDGMENT_REQUIRED"`: the task is AUTOMATION_REQUIRED. Do not close it.

### Human Gate
Yes — for classifying as JUDGMENT_REQUIRED.

### State
`ops/logs/automation-runs.jsonl`.

### Failure Handling
Log is append-only. If you forget to log, log retroactively. The goal is honesty, not perfection.

### Owner
Donovan (writer). Log file is the auditor.

### Status
✅ Documented / Implemented

---

## LR-14 — Neighborhood Expansion Decision

### Trigger
Coverage gap report shows neighborhood with demand but < quality threshold. Or manual expansion decision.

### Input
Neighborhood name. Supabase spot count for that neighborhood at quality threshold.

### Current Manual Steps
1. Run `npm run cafelist:quality-gate --seo --neighborhood="<name>"`
2. If BLOCKED: add to `ops/queues/content-review.json` with blocking reason
3. If ON HOLD: identify what enrichment/scouting would unblock it; add to `ops/state/current-priority.md`
4. If READY: draft page using `ops/templates/seo-page.md`
5. Human reviews and approves page before any push to main

### Reusable System
Quality gate (readiness check) + `ops/templates/seo-page.md` (structure) + `ops/queues/content-review.json` (blocked queue).

### Verification
Quality gate must return READY before page is drafted. All 5 SEO_RULES.md conditions must pass.

### Human Gate
Yes — always. No neighborhood page goes live without human review of both data and copy.

### State
`ops/queues/content-review.json`. `ops/state/seo-state.json`.

### Failure Handling
If quality gate returns BLOCKED: don't create the page. Document in content-review queue.

### Owner
Donovan. Quality gate is the automated checker.

### Status
Documented / Partially Automated

---

## LR-15 — Eval Harness

### Trigger
`npm run eval` — run after any change to: recommender prompt, fit-scorer weights, retriever filters, modes.ts.

### Input
`fixtures/labs-eval-cases.json` (eval cases). Supabase (spot data). Anthropic API (judge).

### Current Manual Steps
1. Run `npm run eval`
2. Review output on `/labs/eval` dashboard
3. If regression > 1.0 quality points: investigate before merging

### Reusable System
`scripts/eval.ts`. Deterministic checks run before LLM judge (trap-detectors, field presence). `/labs/eval` dashboard shows history.

### Verification
Eval harness is its own verification system. Per ADR-0002: recommendations are deterministic; LLM only explains.

### Human Gate
Yes — for deciding whether a regression is acceptable.

### State
`agent_eval_cases`, `agent_eval_runs`, `agent_eval_results` tables (Supabase).

### Failure Handling
Non-zero exit on regression. CI can gate on this.

### Owner
Manual (pre-merge check). CI (automated).

### Status
✅ Automated / Monitored

---

_Last updated: 2026-06-13. Add a new entry whenever a repeated workflow is formalized._
