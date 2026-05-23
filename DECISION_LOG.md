# Decision Log

Append-only. Lightweight ADRs. Read newest-first.

---

## ADR-0004 — Production safety: feature flags + feature branches for all V2 work

**Date:** 2026-05-23
**Status:** Accepted

**Context.** cafelist.app is live and used by real people. The current `/labs` (free-text) is shipped. V2 introduces a new mode picker, new result card, and a new payload shape on `/api/labs/recommend`. Without guardrails, a tired Friday `git push` could regress production.

**Decision.**
- `main` = production. Every push to `main` auto-deploys to cafelist.app.
- All V2 work lives on `feat/labs-*` branches with Vercel preview deployments.
- User-visible V2 surfaces gate behind `NEXT_PUBLIC_LABS_V2=on` (client) and `LABS_V2_ENABLED=on` (server). Flags off in prod env vars; on in preview env vars.
- Branch protection on `main`: PR required + green CI required.
- The flip from V2-off to V2-on in production is a Vercel env-var change, not a code change.

**Alternatives considered.**
- A `/labs/v2` parallel route. Rejected — code drift between `/labs` and `/labs/v2`, and the V2 picker is meant to *replace* the free-text flow eventually (Other path).
- Trunk-based with no flags. Rejected — too easy to ship a half-built picker to cafelist.app.
- Separate Vercel project for V2. Rejected — operational overhead, two domains to maintain.

**Consequences.** Two code paths inside `/api/labs/recommend` until the flag flips. Every V2 PR must verify the flag-off path still works on the preview URL. Database changes must be additive.

**Revisit when.** V2 has been live for 4 weeks with no regressions — at that point delete the flag and the legacy free-text path can be removed in a follow-up PR.

---

## ADR-0003 — Project tracker: GitHub Projects, not Notion/Linear/Airtable

**Date:** 2026-05-23
**Status:** Accepted

**Context.** Labs V2 needs a backlog, milestones, weekly cadence. Options: Notion, Linear (free tier), Airtable, GitHub Projects, the existing `/admin/ops` page.

**Decision.** GitHub Projects (Beta) for project tracking; extend `/admin/ops` with a small "weekly cadence" card so one page can show both project pulse and agent telemetry. No Notion / Linear / Airtable.

**Alternatives considered.**
- Linear free tier. Strong PM ergonomics but it's another tool to keep in sync with GitHub.
- Notion. Too low-friction → low discipline.
- Custom dashboard. `/admin/ops` already exists; duplicating it is waste.

**Consequences.** Tickets, branches, PRs, and milestones live in one place — and the activity itself is the portfolio. Mild lock-in to GitHub; acceptable.

**Revisit when.** A second contributor joins and needs a richer PM tool.

---

## ADR-0002 — Recommendations are deterministic; LLM only explains

**Date:** 2026-05-23
**Status:** Accepted (codifies pre-existing design)

**Context.** Most "AI café finders" prompt a model with the user query and trust whatever comes back. That's a hallucination risk wrapped in a chat UI. We need recommendations that are auditable, ship-able, and not embarrassing when the model has a bad day.

**Decision.**
1. Retrieval is a SQL filter over the Supabase `spots` table — no LLM in the retrieval path.
2. Ranking is a deterministic weighted scorer (`fit-scorer.ts`) consuming structured fields (`workability_score`, `noise_level`, hours, etc.).
3. The LLM (recommender stage) writes a short "why this fits" grounded in the retrieved fields only. It does not select cafés; it explains a selection that was already made.
4. The Evaluator agent grades each recommendation and the eval harness catches regressions.

**Alternatives considered.**
- LLM-as-retriever (e.g. embedding search). Useful future addition for vibe search, but doesn't replace the structured filter for hard constraints like "open after 9pm."
- LLM-as-ranker. Tried briefly — judgments were unstable across reruns. Rejected.

**Consequences.** The system can't surprise a user with a café that has no recorded support for the chosen mode. The flip side: vocabulary like "founder energy" must be backed by structured tags or composed from existing fields.

**Revisit when.** We have enough labeled data to train a hybrid ranker that's stable across reruns.

---

## ADR-0001 — `/labs` V2 primary: mode picker (4 + Other + modifier pills); free text as "Other"

**Date:** 2026-05-23
**Status:** Accepted

**Context.** Today's `/labs` is free-text-only. V2 needs a more structured entry point that maps cleanly to scoring weights. Original proposal was 7 preset modes (Deep Work, Solo Founder, Creative Reset, Coffee Date, Client Meeting, Late-Night, Reading) + Other.

**Decision.** Reduce to **4 primary modes** + Other, with **modifier toggle pills** layered on top of the selected mode.

Primary modes:
1. Deep Work
2. Creative Reset
3. Coffee Date / Social
4. Client Meeting
5. Other / describe what you need

Modifier pills (visible after a mode is selected, multi-select):
- `Open late` — adds `open_after('21:00')` hard constraint
- `Quiet enough to read` — bumps noise weight up
- `Founder energy / community` — bumps community/vibe weight up

**Alternatives considered.**
- Keep 7 cards. Rejected on Hick's-Law grounds — decision fatigue, especially on mobile. "Solo Founder" overlaps with Deep Work; "Late-Night" is Deep Work + a time filter; "Reading/Offline" is Creative Reset minus wifi.
- 5 flat modes, no modifiers. Rejected — loses the late-night and reading vocabulary the user genuinely cares about.

**Consequences.** Two-dimensional mapping (mode × modifiers) is slightly more complex in `modes.ts` but produces a much wider expressive range without bloating the UI. Eval cases must cover both modes alone and mode + modifier combinations.

**Revisit when.** User feedback shows people don't notice or use the modifier pills (collapse to flat 5), OR a modifier outgrows its pill and deserves a primary card (promote it).
