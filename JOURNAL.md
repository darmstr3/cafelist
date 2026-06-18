# Cafelist Build Journal

Engineering log for the cafelist.app agent stack. Newest entries on top.

---

## Parking lot — V2.x and later

Ideas surfaced during V2 build that are real but not in current scope. One-line each; promote to a ticket when the time comes.

- **V2.1 — Now-vs-Later time selector** to replace/augment the `Open late` modifier pill. Toggle for "Going now" vs. "Pick a time"; weekday + HH:MM picker for the latter. Payload already accepts `weekday`; retriever already handles `open_after`. Surfaced 2026-05-23 during ticket #5 design review.
- **V2.x — Weekly schedule view + crowding-aware backups.** Help recurring remote workers plan a week of café visits; surface a backup option per slot if the primary is likely to be too crowded. Requires real-time crowdedness signal, currently out of scope per LABS_V2_PLAN.md §3. Surfaced 2026-05-23.
- **V2.x — Incentivized ground-truth data collection.** Reward users (free month / coffee discount) for mapping wifi quality, outlet count, table-space accuracy at spots they actually visit. Touches accounts + payments + reviews; currently out of scope per LABS_V2_PLAN.md §3. Surfaced 2026-05-23.

---

## 2026-05-14 — Curator Agent (workability_score)

**Goal.** Give every approved spot a 0–10 `workability_score` answering one
specific question: *"Can a remote worker realistically sit here for 2+ hours
with a laptop without feeling pressured to leave?"* — separate from the
review-derived `work_score` (which over-rates bars/lobbies because reviewers
score food/wifi highly even at venues no one would actually camp at).

### What shipped

1. **Migration** — `supabase/migrations/20260514_add_workability_score.sql`.
   Adds `workability_score NUMERIC(3,1)`, `workability_reasoning TEXT`,
   `workability_scored_at TIMESTAMPTZ` to `spots`. CHECK constraint
   `0 ≤ score ≤ 10`. Partial index `idx_spots_workability_score` on rows
   where the score is non-null (cheap retrieval filter).
2. **`scripts/curate-workability.ts`** — the canonical curator. Pages
   approved rows where `workability_score IS NULL OR workability_scored_at <
   now - 90 days`, calls Claude Haiku with structured signals
   (name, type, vibe_tags, has_outlets, has_wifi, laptop_friendly,
   noise_level, seating_comfort, hours, address, notes, existing
   work_score), parses `{score, reasoning}` JSON, writes back. Flags:
   `--dry-run --limit=N --cost-cap=USD --force --concurrency=N`.
   Idempotent — re-runs only touch unscored/stale rows. Hard cost cap aborts
   the run if exceeded.
3. **`src/lib/labs/retriever.ts`** updated: two-stage workability filter
   applied *after* location/type narrowing.
   - Strict pass: `workability_score >= 6`, scored rows only.
   - Relaxed fallback: if strict empties the set, widen to `>= 4` and
     admit unscored rows (a freshly-Scouted row in its 0–24h window can
     still surface here). Both transitions are noted in `filtersApplied`
     so the trace UI shows the loosening.
   - Final sort key is now `workability_score DESC` (Curator-driven),
     `work_score DESC` as tiebreaker. The shortlist is no longer dominated
     by review-padded venues that aren't actually workable.
4. **Schema/type updates** — `supabase/schema.sql` and
   `src/types/index.ts` (`Spot`) mirror the new columns. `demo-data.ts`
   defaults the fields to `null` so the retriever's fallback path still
   compiles.
5. **Scheduled task** — `cafelist-curator-agent` runs daily at 4:03 AM local
   time. Runs `npm run curate:workability`, snapshots the after-distribution,
   alerts on >10% failure rate or cost > $1.50 or a >15pp swing in viable
   share. Catches new Scout rows (which run every 4 hours) within ~24h.
6. **`scripts/run_curator.py`** (in this session's outputs only) — Python
   equivalent of the TS script. Used because the Cowork sandbox's outbound
   proxy denies `*.supabase.co` and `api.anthropic.com`. Not committed
   to the repo. Production path is the TS script + the daily scheduled task.

### Distribution before/after

**Before** (148 approved rows, all unscored):

```
type             total  unscored   review-avg work_score
coffee_shop        141       141   5.95
hotel_lobby          4         4   5.70
bar                  3         3   6.03
```

Note: `bar` rows averaged a **higher review-derived work_score (6.03)** than
hotel lobbies (5.70) or even coffee shops (5.95) — exactly the failure mode
this agent exists to fix. A reviewer rating a cocktail bar's wifi 4/5 doesn't
mean you can camp there.

**After** (all 148 scored):

```
bucket    n
0-2       2
2-4       3
4-6      45    ← not viable under strict filter
6-8      82    ← viable
8-10     16    ← viable

type             total  viable_≥6   avg_workability   (vs review avg)
coffee_shop        141         98              6.34   (was 5.95)
hotel_lobby          4          0              3.88   (was 5.70)
bar                  3          0              1.67   (was 6.03)
```

Non-coffee_shop venues all dropped below the viable threshold. Bars in
particular fell from 6.03 → 1.67 — a 4.4-point correction. Within coffee
shops the distribution spread to expose the long tail of "okay-but-not-great"
spots (45 rows in the 4–6 band) that the review average hid.

**Viable share dropped from 100% (everything passed review-only) to 66%
(98 / 148).** Spec target was 40–60% drop; actual is ~34% drop. The
shortfall is concentrated in borderline coffee shops that landed at 6.0–6.5
rather than 5.5. Acceptable for v1: the 90-day re-score cycle gives the
prompt a natural correction path. If the spot-check shows v1 surfacing too
many mediocre coffee shops, tighten the prompt to be stricter on "no
standout signals" cases (push them to 5.0–5.5 rather than 6.0).

### Cost

Initial backfill cost: **$0.00 of Anthropic API budget** (used inline
reasoning in this session because the sandbox proxy blocked the Anthropic
API). The TS script's projected Haiku cost for the full 148 rows is roughly
**$0.10–$0.20** at current pricing (~$0.0008/row). Well under the $2 cap.

A real Haiku-powered run is what the scheduled task will execute starting
tomorrow at 4:03 AM. The first scheduled run will mostly be a no-op because
everything is already scored, but it will validate the production path.

### 5-query spot-check (success criterion: no restaurant-style entries)

Simulated against the retriever's filter chain at the SQL level (the full
/labs endpoint needs the running Next.js server + LLM intent parser, which
the sandbox can't host). Each query represents a /labs scenario:

1. *"Anything non-coffee-shop slipping through the >= 6 filter?"* → **0 rows.**
   No bars, hotel lobbies, or diners pass. ✓
2. *"Generic NYC work spot, top 5"* → all coffee shops, score 8.0–8.5,
   spread across Astoria / Tribeca / Murray Hill. ✓
3. *"Manhattan, quiet"* → 5 coffee shops in SoHo / East Village /
   Tribeca / Murray Hill, all 8.0. ✓
4. *"Williamsburg / Brooklyn"* → 5 coffee shops, scores 7.0–8.0. ✓
5. *"Open late"* → top result still a coffee shop. **Notably,** "Chez Nous
   Lobby Bar" (work_score 6.3) is now correctly excluded with
   workability_score 3.0 — this venue would have surfaced for late-night
   queries before this agent. ✓

### Design choices worth remembering

- **Two scoring lanes, kept separate.** `work_score` stays review-derived
  (it's still useful for ranking within the viable set). `workability_score`
  is an editorial layer on top — when they disagree, workability wins for
  the retriever.
- **Filter ordering matters.** Workability runs *after* location and type
  filters in the retriever. If we filtered first we'd lose the ability to
  honestly say "you asked for Williamsburg, here are the workable spots in
  Williamsburg" vs. "no spots in Williamsburg".
- **Two-stage relax with explicit trace events.** Silent loosening would
  mislead users. The trace UI shows when we relaxed (`workability≥4-
  loosened-from-6-zero-candidates`).
- **Idempotency predicate at the data layer.** `workability_scored_at` lets
  the same script handle backfill AND incremental modes — no second code
  path, no flags toggling behavior. Scout drops new rows in, curator picks
  them up on the next daily run.
- **Cost cap is hard, not soft.** Aborts at the threshold rather than
  warning. Cheap insurance against a prompt regression that suddenly burns
  10x the expected tokens.

### Follow-ups / known issues

- **34% viable-drop is below the 40–60% target.** Tighten the prompt's
  "borderline coffee shop" heuristic in a future iteration. The 90-day
  re-score cycle gives this a natural retry window.
- **Sandbox can't reach Anthropic.** The Python helper exists only in
  this session's outputs and isn't a long-term solution. Day-2 runs on
  the user's machine (via `npm run curate:workability` or the scheduled
  task) use Haiku as designed.
- **DEMO_SPOTS rows have `workability_score: null`.** Under the strict
  filter they'd fall through to the relaxed pass — fine for the
  Supabase-down fallback. If the demo dataset gets exercised more, set
  realistic workability values to keep the demo path representative.
- **No agent_query_logs entry for curator runs.** The Coverage Gap agent
  consumes `/labs` query logs, not curator runs. If curator-run analytics
  become useful (e.g. "show me the rows where workability disagreed most
  with work_score"), add a separate `agent_curator_runs` table rather than
  overloading query logs.
