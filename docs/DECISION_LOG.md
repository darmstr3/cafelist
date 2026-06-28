# CafeList Operations Decision Log

_For product/architecture decisions, see `DECISION_LOG.md` at the repo root (ADR format)._

_This file records operational decisions: experiments run, automation choices, data operations, and debugging findings. Append-only. Newest first._

Rule: **No experiment may be repeated without explaining what has changed since the last attempt.**

---

## Template

```
## OPS-NNNN — <Short title>
**Date:** YYYY-MM-DD
**Type:** experiment | automation | data-op | debug | expansion
**Status:** completed | in-progress | abandoned

**What was attempted.**
One paragraph.

**Why.**
The goal or hypothesis.

**Expected outcome.**
What success would look like.

**Actual outcome.**
What actually happened. Be honest.

**Learned.**
The specific insight this generated.

**Repeat?**
yes (conditions: ...) | modified (what changes: ...) | no (reason: ...)
```

---

## OPS-0007 — CafeList Ops System Initialization

**Date:** 2026-06-13
**Type:** automation
**Status:** completed

**What was attempted.**
Created the `ops/` directory structure, `docs/REPETITION_AUDIT.md`, `docs/LEVERAGE_REGISTRY.md`, and three implemented scripts (`cafelist-quality-gate.ts`, `cafelist-check-stale.ts`, `cafelist-find-duplicates.ts`) to address the "no repeated manual work" operating principle. Added npm scripts to `package.json`.

**Why.**
The project had grown to 5 automated agents but lacked a system for ensuring that the human operator (Donovan) never performed the same non-trivial task twice without creating reusable leverage. Coverage gap reports had been written 3 times manually; duplicate detection had never been done despite bulk imports; quality checks existed as documentation but not as runnable code.

**Expected outcome.**
A self-reinforcing operations system where every recurring task has a documented workflow, the three highest-leverage gaps are filled with working scripts, and future repeated tasks are automatically flagged for systemization.

**Actual outcome.**
Implemented. See `docs/REPETITION_AUDIT.md` (64 tasks audited), `docs/LEVERAGE_REGISTRY.md` (15 workflow entries), and three new scripts. Estimated 40–61 hours/month of manual work replaced or reduced.

**Learned.**
Most of the high-leverage automation work was in data quality detection (quality gate, stale check, duplicate finder) — areas where humans were doing expensive manual Supabase queries. The automation risk for these is low because they are read-only detection systems that write to queues for human review, not autopilot systems that mutate data.

**Repeat?**
Modified — revisit quarterly to update REPETITION_AUDIT.md with new recurring tasks and close completed automation items.

---

## OPS-0006 — Coverage Gap Upsert Bug

**Date:** 2026-05-25
**Type:** debug
**Status:** completed

**What was attempted.**
Coverage gap script ran (May 25 report) but `scout_priority` upsert failed silently for `source='coverage_gap'` entries.

**Why.**
The `scout_priority` table has a unique index on `(city, neighborhood)`. When rows with the same (city, neighborhood) already exist from `source='manual'` or `source='backfill'`, the coverage_gap upsert collides and the new priority_score is silently dropped.

**Expected outcome.**
Coverage gap priorities override or update existing rows.

**Actual outcome.**
Rows with existing (city, neighborhood) were not updated. Zero `coverage_gap` entries in `scout_priority` after the run.

**Learned.**
The upsert needs a conflict resolution clause: `ON CONFLICT (city, neighborhood) DO UPDATE SET priority_score = EXCLUDED.priority_score, source = EXCLUDED.source` — but only when the new priority_score is higher. This is a policy decision (higher-priority source wins) not just a SQL fix.

**Repeat?**
Modified — fix the upsert clause before next coverage gap run. Document conflict policy: coverage_gap priority_score takes precedence when > existing value.

---

## OPS-0005 — Agent Query Logs Zero-Row Anomaly

**Date:** 2026-06-08
**Type:** debug
**Status:** in-progress

**What was attempted.**
Coverage gap report for 2026-06-08 window showed zero rows in `agent_query_logs` despite `/labs` being live.

**Why.**
Coverage gap relies on query logs to prioritize Scout. Zero logs means Scout runs blind on hardcoded seeds rather than demand signals.

**Expected outcome.**
Logs accumulate from real /labs queries.

**Actual outcome.**
4 total rows, all from 2026-05-20 to 2026-05-25. Zero in the 14 days prior to the June 8 report. Either no traffic (possible — product is in early testing) or the write path to `agent_query_logs` is broken.

**Learned.**
The `/api/labs/recommend` route's call to `query-logger.ts` needs verification. Could be: (1) no actual traffic, (2) write silently failing, (3) route not deployed. Check by making a test query to `/api/labs/recommend` while watching Supabase logs.

**Repeat?**
Modified — next debug pass: hit `/api/labs/recommend` directly with a known query and check if a row appears in `agent_query_logs` within 30 seconds.

---

## OPS-0004 — Fort Greene Neighborhood Expansion (Blocked)

**Date:** 2026-06-06
**Type:** expansion
**Status:** abandoned

**What was attempted.**
Growth OS demo run targeting Fort Greene, Brooklyn. Attempted to create a neighborhood landing page with full data pipeline: Scout → Enrich → Curate → SEO page.

**Why.**
Fort Greene was identified as a high-demand neighborhood in early coverage gap runs.

**Expected outcome.**
A published `/best-cafes-to-work-in-fort-greene` page with ≥ 3 qualifying spots.

**Actual outcome.**
BLOCKED. Fort Greene spots had insufficient enrichment (outlets unverified, hours not structured for most spots). Quality gate would return ON HOLD or BLOCKED. Demo not completed.

**Learned.**
The enrichment pipeline must complete before neighborhood expansion is viable. Running `npm run enrich` on a neighborhood before attempting SEO page creation is a mandatory step, not optional. Document in OPERATING_GUIDE: enrich first, then check quality gate, then create page.

**Repeat?**
Modified — re-run after: (1) `npm run enrich --neighborhood="Fort Greene"` completes, (2) `npm run curate:workability` re-scores enriched spots, (3) `npm run cafelist:quality-gate --seo --neighborhood="Fort Greene"` returns READY.

---

## OPS-0003 — Prompt Optimizer Baseline

**Date:** 2026-05-23
**Type:** automation
**Status:** completed

**What was attempted.**
Created `scripts/optimize-prompt.ts` to run controlled A/B experiments on the recommender prompt. Records all runs in `agent_prompt_runs` table.

**Why.**
Manual prompt tuning was producing improvements but leaving no audit trail — it was impossible to know which version of the prompt was live or why.

**Expected outcome.**
Reproducible prompt experiments with eval harness integration.

**Actual outcome.**
Completed. Audit table records all prompt versions and their eval scores. Promotion rule: new prompt only promoted if eval score ≥ current + 0.5.

**Learned.**
The promotion threshold of 0.5 eval points is conservative but appropriate. Avoid running optimizer during peak hours (Anthropic Tier 1 rate limits).

**Repeat?**
Yes — run optimizer quarterly or when eval harness shows regression > 1.0 points.

---

## OPS-0002 — Vercel Cron for Scout (Replaces Cowork Dispatcher)

**Date:** 2026-05-16
**Type:** automation
**Status:** completed

**What was attempted.**
Replaced broken Cowork-based scheduled dispatch for Scout with Vercel Cron targeting `/api/scout`.

**Why.**
Cowork dispatcher was failing silently. Scout wasn't running. City coverage was not expanding.

**Expected outcome.**
Scout runs every 4 hours reliably via Vercel Cron.

**Actual outcome.**
Working. `scout_runs` table confirms regular execution. Cost caps prevent runaway spend.

**Learned.**
Vercel Cron is more reliable for production scheduled work than Cowork dispatch for this use case. Vercel Cron requires `vercel.json` config AND the Vercel env vars deployed (cannot use only `.env.local`). This is a known gotcha documented in cafelist_scout_agent memory.

**Repeat?**
Yes — use Vercel Cron for any scheduled task that must run reliably in production.

---

## OPS-0001 — Admin Basic Auth Middleware

**Date:** 2026-05-14
**Type:** automation
**Status:** completed

**What was attempted.**
Added Basic Auth middleware on `/admin/*` and mutating API routes.

**Why.**
The admin dashboard was publicly accessible. Any route that mutates the database needed a gate.

**Expected outcome.**
401 for unknown credentials on all admin routes. Fails closed in production.

**Actual outcome.**
Working. Documented in `cafelist_admin_gate` memory. Key: middleware must use `ADMIN_USER` + `ADMIN_PASSWORD` env vars set in Vercel (not `.env.local` only).

**Learned.**
"Fails closed" means the middleware returns 401 when env vars are missing. This is the right behavior — a misconfigured gate that denies access is better than a misconfigured gate that allows it.

**Repeat?**
No — completed. Extend if new admin routes are added.

---

_Add new entries above this line. Oldest entries at bottom._
