# Cafelist Labs V2 — Execution System

_Owner: Donovan • Project Lead Agent: Claude • Started: 2026-05-23_

A practical operating doc. Read in order; nothing here is decorative.

---

## 1. Product mission (one paragraph)

Cafelist Labs helps people find a café for **what they're trying to do**, not just what's nearby. The user picks a mode (Deep Work, Creative Reset, Client Meeting, Coffee Date, Late-Night Work, Reading/Offline, Solo Founder Energy, or "Other → describe"), optionally pins a neighborhood, and gets 3–5 recommendations with reasons, tradeoffs, tags, and a confidence score. The recommendations are produced by a **deterministic retriever + scorer over structured café data**, with an **LLM explanation layer** that articulates *why* each match fits the mode — never invents facts. Labs is the AI-native V2 layer; the existing cafelist.app stays untouched.

---

## 2. MVP scope (Week 1–4)

Ship-blocking only. If a feature isn't here, it's not in the MVP.

1. **Mode picker UI** on `/labs` — **4 primary modes + Other + modifier pills**. Modes: Deep Work, Creative Reset, Coffee Date / Social, Client Meeting. Plus "Other / describe what you need" as a 5th card. After a mode is selected, a small row of toggle pills appears: `Open late` · `Quiet enough to read` · `Founder energy / community`. The pills compose with the mode rather than multiplying the primary choices. Replaces today's free-text-only entry as the primary flow (free-text is preserved as "Other").
2. **Mode → weights/constraints mapping** (`src/lib/labs/modes.ts`) — declarative. Each mode contributes hard constraints and a weights vector consumed by the existing `fit-scorer`. Modifier pills layer additional constraints (`Open late` → `open_after('21:00')`, `Quiet enough to read` → noise weight up, etc.). The intent parser is bypassed when a mode is selected; only the optional free-text "what you need" augments the parsed intent.
3. **Result card v2** — 3–5 recommendations, each showing: name, mode-fit reasons (2 short bullets), tradeoffs (1 bullet), tags, confidence score (0–100, derived from existing `workability_score` + fit_score + retriever filter level). One card-level "why this fits Deep Work" explanation from the LLM, ≤ 2 sentences, grounded in retrieved facts only.
4. **Location input** — neighborhood string OR "use my location" (browser geolocation). Falls back gracefully when permission is denied.
5. **Telemetry** — every Labs query already logs to `agent_query_logs` via `query-logger.ts`; extend the schema with `mode` + `mode_freeform` so the Coverage-Gap Agent can prioritize Scout by mode demand.
6. **The proof layer** — README rewrite, public GitHub repo, GitHub Actions CI (typecheck + lint + one smoke test), CHANGELOG.md, SHIP_LOG.md, DECISION_LOG.md, all populated from Week 1 onward.

That's the MVP. Everything else (below) is V2.1+.

---

## 3. Explicitly NOT building yet

Listing these saves future Donovan from scope-creep arguments with present Donovan.

- **Accounts, auth for end users, saved favorites.** Labs is anonymous-only for V2.
- **Mobile native app.** Mobile web only.
- **A map view.** List-only results until the mode picker drives meaningful demand.
- **In-app review collection on /labs.** Reviews still live on the main app.
- **Multi-city onboarding flow.** Scout already does city rotation; Labs uses what's in the DB.
- **Real-time crowdedness / "how busy now".** Out of scope without a data source.
- **AI-generated café facts.** Hard rule: the LLM explains over retrieved fields. If a field isn't in the DB, the LLM doesn't claim it. Enforced by the recommender prompt + the existing evaluator + the eval harness.
- **A second admin operator.** Keep the Basic-Auth middleware gate.
- **Payments / premium tier.** Not in this phase.

---

## 4. Recommended dashboard setup

**Recommendation: GitHub Projects (Beta) for tickets + the existing `/admin/ops` page for agent telemetry. Skip Notion/Airtable/Linear.**

Why: you already have `/admin/ops` aggregating Scout / Curator / Coverage-Gap / Optimizer / Eval health. Adding a parallel Notion duplicates work. GitHub Projects keeps tickets, branches, PRs, and milestones in one place — and the activity itself is the portfolio.

Concrete setup (do this once, takes ~30 min):

- Create a **public** GitHub repo `cafelist` (private is fine if you're not ready, but flip public by end of Week 2 — this is the portfolio).
- Enable **GitHub Projects (Beta)** in the repo. One board, three columns: `Backlog`, `In progress`, `Shipped this week`.
- Add **milestones**: `Labs V2 — MVP`, `Labs V2.1 — Polish`, `Labs V2.2 — Recruiter-ready`.
- Add **labels**: `area:labs`, `area:agents`, `area:devex`, `area:portfolio`, `type:feat`, `type:bug`, `type:docs`, `type:test`, `prio:p0`, `prio:p1`, `size:s/m/l`.
- Extend `/admin/ops` with a small "Weekly cadence" card (commits this week, open PRs, last shipped feature, last ship log entry) so the agent-health view also shows project pulse. Tiny query against GitHub's REST API on the server, cached 10 min.

Fallback if you'd rather: Linear free tier, same column structure. Don't use Notion for tickets — too low-friction means too low-discipline.

---

## 5. GitHub workflow

### One-time setup (this week)

1. **Create the remote.** `gh repo create cafelist --public --source=. --remote=origin` (or use the GitHub UI).
2. **Squash-or-keep decision.** You currently have one commit (`Initial commit (pre-optimizer baseline)`) + 17 uncommitted files. Don't squash — instead, **land the uncommitted work as a series of themed commits** so the history reads like the real story. Suggested batches (each its own commit, on `main` before branching discipline starts):
   - `feat(labs): mount labs experience, intent parser, retriever, recommender`
   - `feat(labs): add eval harness + /labs/eval dashboard`
   - `feat(agents): add Scout, Curator, Coverage-Gap, Prompt Optimizer`
   - `feat(admin): single-page /admin/ops + Vercel Cron + admin Basic Auth`
   - `chore: vercel.json, env example, JOURNAL.md`
3. **Push to `main`.** Tag the result `v0.1.0-baseline`. This is your "Labs V1" snapshot — everything after is V2.
4. **Branch protection on `main`** (Settings → Branches): require PR, require status checks, require CI to pass.

### Day-to-day flow

- **One ticket = one branch = one PR.** Branch naming: `feat/labs-mode-picker`, `fix/labs-empty-state`, `docs/changelog-week-1`.
- **Commit format:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`). One scoped concern per commit; if your commit message has "and" in it, split the commit.
- **PRs against `main`**, even solo. Self-review is real review — you'll catch things. Use the PR description template (below) every time.
- **Merge style:** squash-merge with the Conventional Commit message as the squash title. This makes `git log` readable from 10 feet away.
- **Tag a release every Friday** if anything user-visible shipped. `git tag v0.2.0 -m "Labs V2: mode picker"` then `git push --tags`. Cut a GitHub Release with the week's changelog entry as the body — these show up under "Releases" on the repo home and are the artifact recruiters skim.

### PR description template (paste this into `.github/PULL_REQUEST_TEMPLATE.md`)

```markdown
## What
One-sentence summary.

## Why
The user-facing or technical reason this exists.

## How
Bullet list of the meaningful changes.

## Proof
- [ ] Manual test: <what you clicked/ran>
- [ ] Screenshot or Loom (for UI changes)
- [ ] `npm run lint` clean
- [ ] `npm run eval` delta acceptable (for prompt/scoring changes)

## Risk
What could break and how I'd know.
```

---

## 6. Weekly shipping cadence

A week looks like this. Same rhythm every week.

| Day | Block | Activity |
|---|---|---|
| Mon | 30 min | Triage the board. Move tickets. Pick the week's "one visible improvement." |
| Tue–Thu | Build blocks | Branch → code → PR → merge. Aim for 3–5 commits across the week, not bursts. |
| Fri | 45 min | Tag release. Update CHANGELOG, SHIP_LOG, DECISION_LOG. Capture 1 screenshot. Outline 1 Loom (don't have to record). |
| Sun | 20 min | Draft 1 short public-facing post (LinkedIn / X / your portfolio). Stage, don't post — post Monday morning. |

**The forcing function:** every Friday `git tag` + GitHub Release. If you didn't ship anything taggable, the cadence is broken — fix it Monday. Missing one week is fine; missing two means scope is too big.

**Weekly deliverables (every week, no exceptions):**
- ≥ 3 meaningful commits on `main` (via PRs)
- 1 user-visible improvement
- 1 SHIP_LOG entry
- 1 CHANGELOG entry
- 1 short public post drafted
- 1 Loom talking-point outline (1 paragraph, not a recorded video)
- 1 portfolio/case-study fragment

---

## 7. Agent responsibilities (this conversational team)

These are the agents you'll bring back to specific conversations. Each has a single accountability so you know which one to invoke.

**Project Lead Agent** (this agent)
- Owns: this LABS_V2_PLAN.md, the roadmap, weekly tickets, DECISION_LOG, SHIP_LOG, Loom outline drafts.
- Invoked when: starting a new week, scoping a feature, deciding "ship now vs. polish."
- Not for: writing implementation code or doing UX critique.

**UX Agent**
- Owns: copy on `/labs`, mode-picker flow, mobile layout, empty/error states, result card density, the "Other / describe what you need" affordance.
- Invoked when: a feature is functionally working but doesn't feel right.
- Not for: scoring math, retriever logic.

**Data / Recommendation Agent**
- Owns: `src/lib/labs/modes.ts` (mode → weights mapping), `fit-scorer.ts`, `retriever.ts` filter rules, eval cases in `fixtures/labs-eval-cases.json`, prevention of hallucinated facts in the recommender prompt.
- Invoked when: a mode feels wrong, a recommendation cites a field the DB doesn't have, eval quality moves.
- Not for: UI, copy.

**Engineering Agent**
- Owns: file/component structure, GitHub Actions workflow, tests, error handling, performance, deploy readiness, the `getSpots`/page contract mismatch.
- Invoked when: shipping requires plumbing (CI, env vars, migrations, Vercel config).
- Not for: deciding what to build.

**Portfolio / Story Agent**
- Owns: README, CHANGELOG body, recruiter-facing case study (`docs/case-study.md`), Loom outlines, public post drafts, the "screenshots to capture" list.
- Invoked when: it's Friday and the week needs to be packaged.
- Not for: anything pre-Friday.

---

## 8. Week 1 build tickets

The tickets below are the literal Week 1 backlog. Add each one to the GitHub Project as an issue. Owners refer to the agent team above.

### Setup (Mon, 1 sitting)

- **#1 chore(repo): create public GitHub remote and push current state** — Engineering. Run the steps in §5 "One-time setup". Tag `v0.1.0-baseline`. Acceptance: repo is live, baseline tagged, branch protection on `main`.
- **#2 chore(ci): add minimal GitHub Actions workflow** — Engineering. Workflow runs on PR: `npm ci`, `npm run lint`, `tsc --noEmit`. No tests yet — that's #11. Acceptance: PR shows green check.
- **#3 docs: rewrite README for Labs V2** — Portfolio. New README leads with: (1) one-paragraph product mission, (2) a 30-sec screen recording placeholder, (3) the agent architecture diagram (text/ASCII is fine), (4) tech stack, (5) how the deterministic retriever + LLM-explanation pattern works, (6) link to LABS_V2_PLAN.md. Acceptance: a recruiter spending 60 seconds gets the pitch.
- **#4 docs: add CHANGELOG.md, SHIP_LOG.md, DECISION_LOG.md, JOURNAL.md** — Portfolio. Use the templates in §11–§14. JOURNAL.md already exists (from prompt-optimizer); just check it in.

### Labs V2 MVP build (Tue–Thu)

- **#5 feat(labs): mode picker UI on /labs** — UX + Engineering. 4 preset cards (Deep Work, Creative Reset, Coffee Date / Social, Client Meeting) + Other card. After selection, a row of modifier toggle pills (`Open late`, `Quiet enough to read`, `Founder energy / community`). Optional neighborhood input + optional free-text "what else should we know" always visible after mode pick. **Gated behind `NEXT_PUBLIC_LABS_V2=on` feature flag** — production gets the existing free-text /labs until we flip the flag. State stays local. Acceptance: with the flag on, picking a mode + modifiers + submit triggers `/api/labs/recommend` with payload `{ mode, modifiers: string[], modeFreeform?, location, weekday }`. With the flag off, /labs renders today's free-text UI unchanged.
- **#6 feat(labs): modes.ts — declarative mode → weights/constraints + modifiers** — Data/Recommendation. Single source of truth: `MODES: Record<ModeId, { label, blurb, hardConstraints, weights, exampleQuery }>` plus `MODIFIERS: Record<ModifierId, { label, hardConstraints?, weightDeltas? }>`. Acceptance: removing one mode card or modifier pill from the UI is a 1-line UI change; the scorer never imports UI code.
- **#7 feat(api): /api/labs/recommend accepts mode payload** — Engineering. When `mode` is present, skip `parseIntent` and synthesize a `ParsedIntent` from `MODES[mode]` + active `modifiers` + `modeFreeform`. Free-text-only path (Other) keeps current behavior. Acceptance: existing eval harness still passes; new "mode payload" code path covered by ≥ 1 eval case per mode and ≥ 1 case combining mode + modifier.
- **#8 feat(db): add `mode`, `mode_freeform` columns to `agent_query_logs`** — Data/Recommendation. Migration in `supabase/migrations/`. Update `query-logger.ts` to record. Acceptance: a Labs query with mode=`deep_work` shows up in Supabase with the column populated.
- **#9 feat(labs): result card v2 with confidence + reasons + tradeoffs** — UX + Data/Recommendation. Pull confidence from existing scores: `confidence = round(100 * (0.5 * workability_score/10 + 0.4 * fit_score + 0.1 * retriever_strictness))`. Display 3–5 cards. Acceptance: each card has name, 2 reason bullets, 1 tradeoff bullet, tags, 0–100 confidence, ≤ 2-sentence LLM "why" grounded in retrieved fields only.
- **#10 fix(labs): graceful empty state when no candidates pass the filter** — UX. Reuse the retriever's filter-relaxation trail (already in `filtersApplied`) to explain *why* results are thin. Acceptance: querying "Late-Night Work in Cleveland" (a city with zero coverage) returns a friendly "we don't have enough data here yet — Scout has been notified" with no fake recs.

### Quality infrastructure (Thu–Fri)

- **#11 test: smoke test for `modes.ts` + eval-checks** — Engineering. Vitest. One test per mode verifying `MODES[mode].hardConstraints` and weights are well-formed; one test that `runDeterministicChecks` rejects an obviously-wrong recommendation. Acceptance: `npm test` passes, runs in CI.
- **#12 feat(eval): add ≥ 1 case per mode to labs-eval-cases.json** — Data/Recommendation. 7 new cases (mode-tagged). Re-run `npm run eval` locally and capture the new baseline. Acceptance: /labs/eval dashboard shows mode-tagged cases passing det checks, judge avg ≥ baseline.

### Proof artifacts (Fri)

- **#13 docs: record Week-1 SHIP_LOG entry + first CHANGELOG entry** — Portfolio. Capture the 4 screenshots in §10. Outline the Week-1 Loom (don't record yet — outline only). Acceptance: SHIP_LOG and CHANGELOG both have Week-1 entries; `screenshots/` folder has 4 PNGs; `docs/looms/week-1.md` has the outline.

---

## 9. Definition of done for Week 1

A simple checkbox list — Week 1 is "done" when all of these are true.

- [ ] Public GitHub repo exists at `github.com/<you>/cafelist` (or private with a clear flip-public date).
- [ ] `v0.1.0-baseline` tag exists and `v0.2.0-mode-picker` (or similar) is released by Friday.
- [ ] Branch protection on `main` enforced.
- [ ] GitHub Actions CI green on the latest PR.
- [ ] README rewritten — a recruiter understands the project in 60 seconds.
- [ ] `/labs` opens to the mode picker. All 7 modes + Other render and submit. Empty states are friendly.
- [ ] Submitting any mode produces 3–5 cards with name + reasons + tradeoffs + confidence + ≤2-sentence LLM "why." No hallucinated facts in any card you spot-check.
- [ ] `agent_query_logs` is recording `mode`/`mode_freeform`.
- [ ] At least 7 new eval cases (one per mode) live in `fixtures/labs-eval-cases.json` and the dashboard shows them.
- [ ] CHANGELOG.md, SHIP_LOG.md, DECISION_LOG.md all have a Week-1 entry.
- [ ] 4 screenshots in `/screenshots/` and 1 Loom outline in `/docs/looms/week-1.md`.
- [ ] One short public-facing post drafted in `/docs/public-posts/week-1.md` (don't post until Monday).

If you slip on #11 (tests) or #12 (eval cases), still ship — but file follow-up tickets and don't let them slip a second week.

---

## 10. Screenshots / artifacts to capture (Week 1)

Keep in `/screenshots/` in the repo. These are what your case study and LinkedIn posts pull from.

1. **`labs-mode-picker.png`** — the new picker, all 7 modes visible, on desktop.
2. **`labs-mode-picker-mobile.png`** — same, on mobile viewport.
3. **`labs-result-card.png`** — a successful recommendation with the confidence score, reasons, tradeoffs, and the LLM "why" expanded.
4. **`labs-empty-state.png`** — the friendly empty state for a low-coverage city (proves you handle failure).
5. (Stretch) **`admin-ops-dashboard.png`** — `/admin/ops` showing all 5 agent panels green. Shows operational maturity.
6. (Stretch) **`labs-eval-dashboard.png`** — `/labs/eval` with new mode-tagged cases. Shows you measure your AI.

For the Loom: outline only this week. Aim to record by Week 3.

---

## 11. Decision log template

Lives at `/DECISION_LOG.md`. Append-only. Lightweight ADR.

```markdown
## ADR-NNNN — <Short decision title>
**Date:** YYYY-MM-DD
**Status:** Proposed | Accepted | Superseded by ADR-XXXX

**Context.** What forced this decision? One paragraph.

**Decision.** What you chose.

**Alternatives considered.** 1–3 bullets — the ones that lost.

**Consequences.** Tradeoffs you're accepting. What will hurt later.

**Revisit when.** A trigger condition (e.g. "if we ever add a second admin user").
```

Suggested Week-1 ADRs to write: ADR-0001 "Mode picker as primary; free text as fallback." ADR-0002 "Deterministic retriever + LLM explanation, not LLM recommendation." ADR-0003 "GitHub Projects over Notion/Linear."

---

## 12. Ship log template

Lives at `/SHIP_LOG.md`. Newest at top. Designed to be skimmed.

```markdown
## YYYY-MM-DD — v0.X.0 — <release title>

**What shipped (user-visible).**
- Bullet, ≤ 1 line each.

**What shipped (under the hood).**
- Bullet.

**Numbers.** Commits this week: N. PRs merged: N. Open issues: N. Eval quality: X.X (Δ ±).

**Surprises.** One sentence on anything unexpected.

**Next.** The one thing next week is about.

**Links.** PR #N, Release v0.X.0, screenshots, Loom outline.
```

---

## 13. Changelog template

Lives at `/CHANGELOG.md`. Follow [Keep a Changelog](https://keepachangelog.com).

```markdown
# Changelog

## [Unreleased]
### Added
### Changed
### Fixed

## [0.2.0] — 2026-05-29
### Added
- /labs mode picker (Deep Work, Solo Founder, Creative Reset, Coffee Date, Client Meeting, Late-Night, Reading, Other).
- `mode` + `mode_freeform` columns on `agent_query_logs`.
- 7 new mode-tagged eval cases.
### Changed
- Result card now shows confidence (0–100), reasons, tradeoffs.
- `/api/labs/recommend` accepts a structured `mode` payload.
### Fixed
- Empty state when retriever returns 0 candidates.

## [0.1.0-baseline] — 2026-05-23
Initial public snapshot. Labs V1 (free-text only), Scout, Curator, Coverage-Gap, Prompt Optimizer, Eval Harness, /admin/ops, admin Basic Auth.
```

---

## 14. Weekly Loom outline template

Lives at `/docs/looms/week-N.md`. Outline only is fine — record when you have energy.

```markdown
# Loom — Week N (YYYY-MM-DD)

**Length target:** 3–5 minutes.

**Audience.** Recruiters / founders skimming. Assume they know nothing about Cafelist.

**Cold open (15s).** "Cafelist Labs helps you find a café for what you're trying to do — not just what's nearby. Here's what I shipped this week."

**Walkthrough (2–3 min).**
1. Open `/labs`. Click <mode>. Submit.
2. Point at one card. "The recommendation is deterministic — these scores come from a SQL filter and a weighted scorer over real café data. The LLM only writes the explanation. That's the whole point — no hallucinated facts."
3. Open the Trace panel. "You can see every stage: parse → retrieve → score → recommend → evaluate."
4. Open `/admin/ops`. "Five agents keep the data flowing — Scout discovers, Curator scores, Coverage-Gap reprioritizes, Optimizer tunes prompts, Eval measures quality."

**Close (30s).** "This week I shipped <one thing>. Next week is <one thing>. Repo: github.com/<you>/cafelist. Live: cafelist.app/labs."

**Don't say.** "Just," "kind of," "I think." Re-record if you do.
```

---

## 15. Scheduled task ideas (to make this semi-autonomous)

You already have these scheduled tasks live: `cafelist-observability-agent` (15min), `cafelist-curator-agent` (daily 04:03), `cafelist-coverage-gap` (Mondays 07:00), `cafelist-scout-agent` (backup). Add the following project-management ones — they're what keeps the cadence alive when work drains you.

| When | Task | What it does |
|---|---|---|
| Every Mon 07:30 | **Weekly kickoff** | Pull the current GitHub Project board state, summarize what's in `In progress` and `Backlog`, suggest the one "visible improvement" for the week, draft tickets that don't exist yet. Posts the summary into a Cowork artifact. |
| Every weekday 18:00 | **End-of-day nudge** | If 0 commits today AND there's an `in_progress` ticket, gently surface: "ticket #N is open, last touched X days ago — pick it up tomorrow or move it back to Backlog." |
| Every Fri 16:00 | **Ship log draft** | Pull this week's commits + closed PRs + merged tickets via `gh` CLI, draft a SHIP_LOG entry and a CHANGELOG block. Leave both as draft PRs for Donovan to review and merge. |
| Every Fri 16:30 | **Release draft** | If at least one user-visible commit this week, draft a GitHub Release body with the changelog entry and a list of screenshots. Don't auto-publish — surface the draft URL. |
| Every Sat 09:00 | **Public-post draft** | Look at the week's SHIP_LOG entry + screenshots. Draft 1 LinkedIn post + 1 X post in `/docs/public-posts/week-N.md`. Don't post — surface for review. |
| Every Sun 19:00 | **Portfolio gap check** | Compare what shipped this month vs. the case-study sections marked `[TODO]`. Flag the next case-study section to fill in. |
| 1st of month 09:00 | **Monthly recruiter-facing summary** | Generate a one-page summary of the month: features shipped, eval quality trend, agent telemetry highlights, 1 chart. Saves to `/docs/monthly/YYYY-MM.md`. |
| Every Wed 12:00 | **UX critique pass** | Run the existing eval harness; flag any case that regressed > 1.0 quality point; suggest 1 specific copy or layout tweak. Don't auto-apply. |
| Every Tue 09:00 | **Stale-ticket sweep** | Anything `In progress` for > 5 days gets surfaced with a "still active?" prompt. Forces honest movement. |

**Bias for these to draft, not act.** They surface work to your inbox; you approve. The only currently-running task that mutates production is the existing agent fleet (Scout / Curator / etc.), which is the right level of autonomy. Project-management scheduling should be assistive, never silent.

When you're ready to wire these up, I can spin them up via `mcp__scheduled-tasks__create_scheduled_task` — start with **Weekly kickoff** and **Ship log draft** only. If those feel useful after two weeks, add the rest.

---

## 16. Production safety guardrails

cafelist.app is live and used by real people. The following rules are non-negotiable. If a change can't satisfy them, it doesn't ship.

**1. `main` = production.** Vercel auto-deploys `main` to cafelist.app. Treat every push to `main` as a production release. No experimental code on `main`, ever. Branch protection enforces this (PR + green CI required).

**2. All V2 work lives on feature branches.** Pattern: `feat/labs-mode-picker`, `feat/labs-confidence-card`, etc. Vercel automatically builds a preview deployment per branch (`cafelist-feat-labs-mode-picker.vercel.app`). That's where you (and recruiters via shareable preview URLs) see in-progress work. Production stays clean.

**3. Feature flags gate user-facing V2 surfaces.** The new mode picker, V2 result card, and any other user-visible change land behind `NEXT_PUBLIC_LABS_V2=on` (client) and `LABS_V2_ENABLED=on` (server, for the /api/labs/recommend payload shape switch). In production env vars: flags are OFF until V2 is end-to-end ready. In preview deployments: flags are ON so the new surface is testable. The flip from V2-off to V2-on in prod is a single Vercel env-var change, not a code change.

**4. No partial merges to `main`.** A feature branch only merges when:
- It is functionally complete behind its flag.
- CI is green.
- Eval harness regression check is clean (no case regresses >1.0 quality point).
- You've manually verified the existing /labs (V2 flag off) still works on the preview URL.

**5. Database changes are additive.** Adding columns (`agent_query_logs.mode`, etc.) is safe — existing reads ignore unknown columns. Dropping or renaming columns requires a separate migration PR with a rollback note in DECISION_LOG and a 48-hour gap so it's never bundled with feature work.

**6. The current `/labs` (free-text) keeps working until V2 fully replaces it.** When the V2 flag flips on in prod, the old `/labs` becomes the "Other / describe what you need" branch of the new picker — it doesn't get deleted. Same `/api/labs/recommend` endpoint, two code paths inside it.

**7. The known prod signals get verified, not assumed.** Before any V2 commit, hit `/api/health` and the home page on cafelist.app to confirm the `getSpots` 522 isn't recurring. If it is, that's a P0 ahead of any V2 work.

**8. Rollback plan, always.** Every V2 PR description includes a one-line "to revert: flip `NEXT_PUBLIC_LABS_V2=off` in Vercel" or "to revert: `git revert <sha>` (no migration to undo)." If a PR can't be reverted that simply, it's too big — split it.

These rules make every Loom credible. "I shipped this without breaking production" is a story; "I crashed cafelist.app on a Saturday" is a different story.

---

## Appendix A — Current state audit (as of 2026-05-23)

Surfacing what's actually true, so the plan starts from reality:

**What's already built and on disk:**
- `/labs` is live with a 5-stage pipeline (intent_parser → retriever → fit_scorer → recommender → evaluator), full trace UI, free-text input only. No mode picker yet.
- 5 agents in production: Scout (city rotation, Vercel Cron every 4h), Curator (workability_score, daily 04:03), Coverage-Gap (Mondays 07:00), Prompt Optimizer (manual), Eval Harness (`npm run eval` + `/labs/eval` dashboard).
- `/admin/ops` aggregates all 5 agents on one page. Basic Auth middleware fails closed in prod.
- Supabase tables: `spots`, `agent_query_logs`, `agent_eval_cases/runs/results`, `agent_prompt_runs`, `scout_priority`, `scout_runs`. Workability scoring backfilled.

**What's not yet on GitHub:**
- The repo has **one commit** (`Initial commit (pre-optimizer baseline)`) and **no remote**.
- **17 files are uncommitted**, including the entire `/admin/ops` page, the Vercel Cron config, the admin Basic Auth middleware, the new Scout API route, the eval dashboard, and modifications across `page.tsx`, `spots.ts`, `eval.ts`, `scout.ts`, etc.
- No `.github/workflows/`, no CHANGELOG, no SHIP_LOG, no README rewrite, no tests.

**Open production signals to verify Week 1:**
- `getSpots error` on `/` (Cloudflare 522 to Supabase data-plane) — flagged 2026-05-07/08. May have self-resolved. Hit `/api/health` first thing Monday to check.
- Type/contract mismatch between `src/app/page.tsx` and `src/lib/spots.ts` (`{ spots, serviceError }` vs `Spot[]`) — should be reconciled in Week 1 if still present.

These two together mean: **the single highest-leverage thing this week is getting the existing work into GitHub properly.** That alone produces a portfolio-quality artifact. The mode picker is the second-highest.

---

## Appendix B — How to use this doc

- **Re-read §6 every Monday morning.** That's the heartbeat.
- **Re-read §9 every Friday afternoon.** That's the rubric.
- **When scope creeps,** re-read §2 and §3.
- **When momentum drops,** re-read §15 and turn on one more scheduled task.
- **When a recruiter looks at the repo,** they should see: README (§5) → Releases (§5) → CHANGELOG (§13) → SHIP_LOG (§12) → case study (§10). In that order.

If anything in this doc stops being true, update it in the same PR as the change. This doc is not the plan — it's the operating manual.
