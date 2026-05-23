# Changelog

All notable changes to Cafelist. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning is semver-ish; tags double as portfolio milestones.

## [Unreleased]

### Added
- Operating manual at `LABS_V2_PLAN.md` covering scope, cadence, agent responsibilities, production-safety rules.
- Portfolio docs: `CHANGELOG.md`, `SHIP_LOG.md`, `DECISION_LOG.md`.
- GitHub Actions CI workflow (lint + typecheck on PR).
- PR template at `.github/PULL_REQUEST_TEMPLATE.md`.
- Feature-flag scaffold at `src/lib/labs/feature-flags.ts` — `isLabsV2Enabled()` reads `NEXT_PUBLIC_LABS_V2` (client) / `LABS_V2_ENABLED` (server).
- `NEXT_PUBLIC_LABS_V2` documented in `.env.local.example`.

### Planned (Week 1 — Labs V2 MVP)
- `/labs` mode picker (Deep Work, Creative Reset, Coffee Date / Social, Client Meeting + "Other / describe") with modifier toggle pills (`Open late`, `Quiet enough to read`, `Founder energy / community`). Gated behind `NEXT_PUBLIC_LABS_V2=on`.
- `src/lib/labs/modes.ts` — declarative mode → weights/constraints + modifier mapping.
- `/api/labs/recommend` accepts the new `{ mode, modifiers, modeFreeform?, location, weekday }` payload.
- `agent_query_logs` gains `mode` + `mode_freeform` columns; Coverage-Gap reprioritises Scout by mode demand.
- Result card v2: confidence (0–100), reasons, tradeoffs, ≤ 2-sentence LLM "why" grounded in retrieved fields.
- Friendly empty state surfacing the retriever's filter-relaxation trail.
- ≥ 1 mode-tagged eval case per mode in `fixtures/labs-eval-cases.json`.

## [0.1.0-baseline] — 2026-05-23

Initial public snapshot. This is the state of cafelist before Labs V2 work begins.

### Shipped (in production at cafelist.app)
- **`/labs` V1** — free-text agentic discovery. 5-stage pipeline: intent parser → retriever → fit scorer → recommender → evaluator. Full request trace UI.
- **`/labs/eval`** — eval-harness dashboard with per-case detail, deterministic checks before judge, regression highlighting, prompt-hash versioning.
- **Scout agent** (`/api/scout`, `npm run scout`) — city-rotation Google Places discovery driven by `scout_priority`. Vercel Cron `7 */4 * * *`. Cost caps: $0.50/run, $3/24h.
- **Curator agent** (`npm run curate:workability`) — LLM-scored `workability_score` (0–10) on the spots table. Daily scheduled task at 04:03.
- **Coverage-Gap agent** (`npm run coverage-gap`) — reads `agent_query_logs`, upserts demand-weighted entries into `scout_priority`. Mondays 07:00.
- **Prompt Optimizer** (`npm run optimize:prompt`) — automated prompt search per pipeline stage with strict promotion rule (avg ≥ 5% better AND no case regresses > 1.0 pt). Audit trail in `agent_prompt_runs` + `JOURNAL.md` + git.
- **`/admin/ops`** — single-page operator dashboard aggregating all 5 agents. Server-rendered, manual "Run scout now" action.
- **Admin Basic Auth middleware** (`src/middleware.ts`) — gates `/admin/*` and mutating `/api/spots`, `/api/reviews`, `/api/import`. Fails closed in production.
- **Supabase tables** — `spots`, `agent_query_logs`, `agent_eval_cases/runs/results`, `agent_prompt_runs`, `scout_priority`, `scout_runs`. RLS public-read on non-PII, service-role on writes.
- **`/api/health`** — observability endpoint used by the 15-min observability agent.

### Known signals at baseline (verify before V2 build)
- `getSpots error` on `/` traced to Cloudflare 522 → Supabase data plane (2026-05-07/08). May have self-resolved; check `/api/health` first thing.
- Type/contract mismatch between `src/app/page.tsx` (`{ spots, serviceError }`) and `src/lib/spots.ts` (`Spot[]`). Reconcile in Week 1 if still present.

### Not yet on GitHub at this tag
This is the first push to a public remote. Prior history was local-only. The commits leading up to this tag reify the existing production state as 6 themed commits so the narrative is legible.
