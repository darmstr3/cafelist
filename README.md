# Cafelist

[![CI](https://github.com/darmstr3/cafelist/actions/workflows/ci.yml/badge.svg)](https://github.com/darmstr3/cafelist/actions/workflows/ci.yml)

**Find a café for what you're trying to do — not just what's nearby.**

Live: [cafelist.app](https://cafelist.app) · Experimental agentic layer: [cafelist.app/labs](https://cafelist.app/labs)

---

## What this is

Cafelist is a working product (cafelist.app) plus an agentic R&D surface (`/labs`) where I'm building a different kind of café recommender: pick a **mode** like Deep Work or Client Meeting, and the system retrieves and ranks cafés against the constraints that actually matter for that mode — not just "5-star nearby." The AI explains recommendations grounded in real café data; it does not invent facts.

This repo is also where I do my product-building in public. Roadmap, decisions, and weekly ship logs all live here.

## Why it's interesting

Most "AI café finders" call a model with "find me a quiet café in SoHo" and trust whatever comes back. That's a hallucination risk wrapped in a chat UI. Cafelist Labs separates the two halves:

- **Deterministic retrieval + scoring** runs over a real Supabase-backed café directory. Filters and weights produce a ranked shortlist.
- **LLM explanation layer** writes a short, grounded "why this fits" for each card — but it only references fields that were actually retrieved. The Evaluator agent grades every recommendation and the regression dashboard catches drift.

The result is a system you can ship, audit, and iterate on. There are also five background agents keeping the data flowing — see [Architecture](#architecture).

## Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                          User on /labs                            │
└──────────────────────────────┬────────────────────────────────────┘
                               │  POST /api/labs/recommend
                               ▼
┌───────────────────────────────────────────────────────────────────┐
│  Agentic pipeline (per-request, fully traced)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────┐  │
│  │  Intent  │→ │ Retriever│→ │   Fit    │→ │Recommend │→ │Eval │  │
│  │  Parser  │  │  (SQL)   │  │  Scorer  │  │  -er     │  │-ator│  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └─────┘  │
└──────────────────────────────┬────────────────────────────────────┘
                               │
                  ┌────────────┴────────────┐
                  ▼                         ▼
        agent_query_logs            agent_eval_runs/results
                  │                         │
                  ▼                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  Background agents (scheduled, semi-autonomous)                  │
│  • Scout         — Google Places discovery, every 4h             │
│  • Curator       — workability_score (0–10), daily               │
│  • Coverage Gap  — query-log → Scout priority, weekly            │
│  • Optimizer     — prompt-search with promotion rule, on-demand  │
│  • Eval Harness  — quality regression dashboard at /labs/eval    │
└──────────────────────────────────────────────────────────────────┘
```

`/admin/ops` is a single-page operator dashboard showing all five agents' health.

## Tech

- **Frontend:** Next.js 16, React 19, Tailwind 4, TypeScript
- **Backend:** Next.js API routes, Supabase (Postgres + RLS)
- **AI:** Anthropic Claude (Haiku for hot-path, Sonnet for grading)
- **Data:** Google Places API for discovery
- **Hosting:** Vercel (with Cron for Scout) + Supabase
- **Auth:** HTTP Basic Auth middleware on `/admin` and mutating API routes (fails closed in prod)

## Run locally

```bash
git clone https://github.com/darmstr3/cafelist.git
cd cafelist
npm install
cp .env.local.example .env.local
# Fill in SUPABASE, ANTHROPIC, GOOGLE_PLACES, ADMIN, SCOUT keys
npm run dev
# → http://localhost:3000
# → http://localhost:3000/labs
```

## Working agents (production)

| Agent | What it does | When |
|---|---|---|
| **Scout** | Picks the highest-priority city from `scout_priority`, runs Google Places text queries, dedupes, inserts pending spots. | Every 4h via Vercel Cron |
| **Curator** | LLM-scores `workability_score` (0–10) on new and >90-day spots. | Daily, 04:03 |
| **Coverage Gap** | Reads last 7d of `agent_query_logs`, scores city/neighborhood demand vs. coverage, upserts top 20 into `scout_priority`. | Mondays, 07:00 |
| **Prompt Optimizer** | Searches over prompt variants per stage; promotes a variant iff avg quality > 5% better AND no case regresses > 1.0 pt. Audit trail in `agent_prompt_runs` + JOURNAL.md + git. | On-demand: `npm run optimize:prompt -- recommender` |
| **Eval Harness** | 25-case fixture (`fixtures/labs-eval-cases.json`), in-process pipeline run, deterministic checks + LLM judge, dashboard at `/labs/eval`. | On-demand: `npm run eval` |

## Project docs

- [**LABS_V2_PLAN.md**](./LABS_V2_PLAN.md) — the operating manual for V2: scope, cadence, agent responsibilities, Week-1 tickets, production-safety rules.
- [**CHANGELOG.md**](./CHANGELOG.md) — every shipped change.
- [**SHIP_LOG.md**](./SHIP_LOG.md) — weekly narrative.
- [**DECISION_LOG.md**](./DECISION_LOG.md) — ADRs for non-obvious calls.
- [**JOURNAL.md**](./JOURNAL.md) — engineering log (longer-form).

## Status

- **V1 (free-text `/labs`)** — shipped, in production at `cafelist.app/labs`.
- **V2 (mode picker)** — in development on `feat/labs-v2-*` branches. Gated behind `NEXT_PUBLIC_LABS_V2` env flag. Production stays on V1 until V2 is end-to-end ready.
- **Main = production.** Every PR merge auto-deploys to cafelist.app. See [LABS_V2_PLAN.md §16](./LABS_V2_PLAN.md#16-production-safety-guardrails) for the safety rules.

## License

MIT.
