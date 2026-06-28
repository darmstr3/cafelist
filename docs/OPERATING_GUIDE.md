# CafeList Operating Guide

_How to run CafeList as a compounding system. Read this before doing any recurring work. Updated when new workflows are formalized._

---

## The governing rule

> Manual once for learning. Systemized on the second occurrence. Automated only when verifiable. Human review reserved for exceptions and judgment.

Before starting any task: check `docs/REPETITION_AUDIT.md`. If the task is there, the system exists. Use it.

---

## Quick reference

| I want to... | Command | Then... |
|---|---|---|
| Check data quality across all spots | `npm run cafelist:quality-gate` | Review `ops/reports/quality-gate-*.json` and `ops/queues/manual-review.json` |
| See what's stale or missing | `npm run cafelist:check-stale` | Run enrich/curate on flagged spots |
| Find duplicate spots | `npm run cafelist:find-duplicates` | Review `ops/queues/duplicate-candidates.json`, resolve in Supabase |
| Check SEO readiness for a neighborhood | `npm run cafelist:quality-gate:seo` | Check `ops/state/seo-state.json` |
| Import new spots | `npm run import:nyc:dry` then `npm run import:nyc` | Then run enrich → curate → quality-gate |
| Run enrichment | `npm run enrich:dry` then `npm run enrich` | Then run curate:workability |
| Run curator | `npm run curate:workability:dry` then `npm run curate:workability` | Then run quality-gate |
| Scout new spots | `npm run scout:dry` then `npm run scout` | Curator picks these up daily |
| Check eval quality | `npm run eval` | Review `/labs/eval` dashboard |
| Verify build is clean | `npm run cafelist:build-check` | Fix any errors before pushing |
| Review manual queue | Open `ops/queues/manual-review.json` | Triage items, update Supabase, mark resolved |
| Create a neighborhood page | Check quality-gate, use `ops/templates/seo-page.md` | Human writes, reviews, then PR |
| Record a decision | Edit `DECISION_LOG.md` or `docs/DECISION_LOG.md` | See which log applies (ADR vs ops) |
| Do weekly review | Use `ops/templates/weekly-report.md` | Update `ops/state/current-priority.md` |

---

## Standard workflows

### After a Scout run (or bulk import)

Order matters. Don't skip steps.

```
1. npm run cafelist:find-duplicates      # check for new dupes before doing anything else
2. Review ops/queues/duplicate-candidates.json — resolve definitives before continuing
3. npm run enrich                        # populate enrichment_signals for new spots
4. npm run curate:workability            # score newly enriched spots
5. npm run cafelist:quality-gate         # assess publication readiness
6. Review ops/queues/manual-review.json  # triage flagged spots
```

Don't run curation before enrichment. Curator scores improve significantly with enrichment signals.

---

### Before creating a neighborhood SEO page

```
1. npm run cafelist:quality-gate:seo --neighborhood="[NAME]"
   → Check ops/state/seo-state.json for the result

If READY:
   2. Draft page using ops/templates/seo-page.md
   3. Human reviews all claims against actual DB fields
   4. PR to feat/seo-[neighborhood] branch
   5. Review passes quality checklist (see ops/templates/seo-page.md)
   6. Merge to main

If ON_HOLD:
   2. The report shows what enrichment/verification would unblock it
   3. Add to ops/queues/content-review.json with blocking reason
   4. Re-check after running enrich + curate on neighborhood spots

If BLOCKED:
   2. Add to ops/queues/content-review.json
   3. Do not create the page. Scout the neighborhood first.
```

---

### Weekly review (every Friday)

```
1. Open ops/templates/weekly-report.md
2. Copy to ops/reports/weekly-YYYY-MM-DD.md
3. Fill in: agent health, data metrics, product updates, SEO status
4. Identify top 3 priorities for next week
5. Update ops/state/current-priority.md
6. Add SHIP_LOG.md entry
7. Add CHANGELOG.md entry
```

---

### When something breaks twice

Stop. Don't fix it the same way again.

```
1. Fix it (second time)
2. Open docs/DECISION_LOG.md
3. Add an OPS-NNNN entry with:
   - What broke and why
   - What you tried (both times)
   - What you learned
   - How to prevent it recurring
4. Add to ops/logs/automation-runs.jsonl with occurrence_count ≥ 2
5. If fixable by automation: create a script or check in cafelist:build-check
```

---

## What each script does

### `npm run cafelist:quality-gate`

Checks all `status='approved'` spots against the thresholds in `ai/QUALITY_BAR.md`.

**Output:**
- `publish` — all checks pass
- `hold` — missing required enrichment/curation (fixable)
- `review` — warnings requiring human decision
- `reject` — blocking failures (missing required fields, invalid coordinates)

**Writes to:**
- `ops/reports/quality-gate-YYYY-MM-DD.json` (full results)
- `ops/queues/manual-review.json` (review items only)
- `ops/state/data-freshness.json` (updated summary)
- `ops/state/seo-state.json` (when `--seo` flag used)

**Exit codes:** 0 = all pass, 1 = reviews present, 2 = rejects present.

---

### `npm run cafelist:check-stale`

Finds spots that need enrichment, curation, or verification.

**Categories:**
- `needs_enrichment` — enriched_at IS NULL or > 90 days
- `needs_curation` — workability_scored_at IS NULL or > 90 days
- `needs_verification` — last_verified_at IS NULL or > 180 days
- `missing_fields` — required fields (address, lat/lng, neighborhood) are null

**Writes to:**
- `ops/reports/stale-check-YYYY-MM-DD.json`
- `ops/queues/manual-review.json` (high-priority items)
- `ops/state/data-freshness.json`

**Suggests next steps** in its output.

---

### `npm run cafelist:find-duplicates`

Three-pass duplicate detection: exact place ID match → normalized name match → coordinate proximity (~50m).

**Output confidence levels:**
- `definite` — same `google_place_id` (always merge or reject one)
- `likely` — same normalized name, same city (usually the same place)
- `possible` — within 50m, similar name (needs human judgment — could be neighboring businesses)

**⚠️ HUMAN APPROVAL REQUIRED.** Script is read-only.

**Writes to:**
- `ops/queues/duplicate-candidates.json`
- `ops/reports/duplicates-YYYY-MM-DD.json`

**To resolve:** Open `duplicate-candidates.json`, set `resolved_at`, `resolution` ("merged"|"not_duplicate"|"deferred"), and `resolution_notes`. Then merge manually in Supabase if applicable.

---

### `npm run cafelist:build-check`

Runs: eslint → tsc --noEmit → next build. Equivalent to what CI runs on every PR.

Run before pushing. Don't skip.

---

## Admin review queues

### `ops/queues/manual-review.json`
Items requiring human decision. Written by quality-gate and check-stale.

Each item has: `why_flagged`, `evidence`, `severity`, `recommended_action`, `source_freshness`.

To resolve: set `resolved_at`, `resolution`, and `resolution_notes` on each item. Resolutions: `approved`, `rejected`, `deferred`, `edited`.

### `ops/queues/duplicate-candidates.json`
Candidate duplicate groups. Written by find-duplicates.

To resolve: investigate each group in Supabase. Set `resolved_at` and `resolution` ("merged"|"not_duplicate"|"deferred").

### `ops/queues/content-review.json`
SEO pages and content that is blocked, on hold, or waiting for data.

To add: use the format defined in the file header.

---

## Automated agents (no action needed in steady state)

| Agent | Schedule | What it does | Where to check |
|---|---|---|---|
| Scout | Every 4h (Vercel Cron) | Discovers new spots in priority cities | `/admin/ops`, `scout_runs` table |
| Curator | Daily 04:03 UTC | Scores workability for unscored/stale spots | `/admin/ops`, `spots.workability_scored_at` |
| Coverage Gap | Mondays 07:00 UTC | Updates Scout priority queue from query logs | `reports/coverage-gap-*.md`, `scout_priority` table |
| Eval Harness | Manual or CI | Grades recommendation quality | `/labs/eval`, `npm run eval` |

Monitor these at `/admin/ops`. If an agent shows failure: check the relevant table (`scout_runs`, etc.), diagnose, and run manually if needed.

---

## Decision logs

Two logs, different purposes:

**`DECISION_LOG.md`** (repo root) — ADR format. Product and architecture decisions. When to add: new API design, breaking changes, feature additions, security decisions. Format: ADR-NNNN with Context/Decision/Alternatives/Consequences/Revisit-when.

**`docs/DECISION_LOG.md`** — Operations decisions. Experiments, data operations, debug findings. When to add: after any experiment completes, when a bug is fixed for the second time, when an automation decision is made. Format: OPS-NNNN with What/Why/Expected/Actual/Learned/Repeat?

Rule: **No experiment may be repeated without explaining what has changed since the last attempt.** Check these logs before starting any non-trivial task.

---

## Second-occurrence rule

Whenever you complete a task, append to `ops/logs/automation-runs.jsonl`:

```json
{
  "task": "short description",
  "date": "YYYY-MM-DD",
  "occurrence_count": 1,
  "related_files": ["scripts/...", "docs/..."],
  "reusable_asset": "npm run ... | null",
  "status": "DONE | AUTOMATION_REQUIRED | JUDGMENT_REQUIRED",
  "notes": "optional"
}
```

If `occurrence_count >= 2` and `reusable_asset` is null and the task isn't `JUDGMENT_REQUIRED`: the task is not done. Create the automation before closing.

---

## File structure reference

```
docs/
  REPETITION_AUDIT.md     — 64 recurring tasks audited with status and priority
  LEVERAGE_REGISTRY.md    — 15 workflow entries with trigger/owner/verification
  DECISION_LOG.md         — Operations decision log (OPS-NNNN entries)
  OPERATING_GUIDE.md      — This file
DECISION_LOG.md           — Architecture decisions (ADR-NNNN entries)
ai/
  DATA_SCHEMA.md          — Spot field reliability tiers and confidence vocabulary
  QUALITY_BAR.md          — Pass/fail thresholds for data, SEO, engineering, release
  SEO_RULES.md            — Rules for programmatic SEO pages
  PRODUCT_PRINCIPLES.md   — Non-negotiable product behavior rules
ops/
  state/
    current-priority.md   — This week's top 3 priorities (update every Friday)
    data-freshness.json   — Freshness summary (auto-updated by check-stale)
    seo-state.json        — SEO neighborhood readiness (auto-updated by quality-gate)
  queues/
    manual-review.json    — Items requiring human decision
    duplicate-candidates.json — Duplicate groups awaiting resolution
    content-review.json   — SEO pages blocked or on hold
  reports/                — Date-stamped output from scripts (auto-generated)
  logs/
    automation-runs.jsonl — Second-occurrence log (append manually)
  prompts/
    maker.md              — Template for AI maker tasks
    checker.md            — Template for AI checker tasks
  decisions/
    decision-log.md       — Points to docs/DECISION_LOG.md
  templates/
    seo-page.md           — Template for neighborhood/category SEO pages
    weekly-report.md      — Template for weekly growth review
scripts/
  cafelist-quality-gate.ts   — System 1: Publication quality gate
  cafelist-check-stale.ts    — System 2: Stale data detection
  cafelist-find-duplicates.ts — System 3: Duplicate finder
  (existing scripts...)
```

---

_Last updated: 2026-06-13. Update this guide when any workflow or command changes._
