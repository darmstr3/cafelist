# Cafelist — Quality Refinement Plan

_Date: 2026-06-28 · Owner: Donovan · Status: proposed_

Trigger: homepage grid is publishing low-fitness ("unfit") spots and broken-image
cards. This plan diagnoses why, confirms ingestion is stopped, and lays out the
work to clean up the catalog and prevent recurrence.

---

## 1. Root causes (confirmed against production)

### 1a. The homepage has no fitness gate — the recommender does
`getSpots()` (`src/lib/spots.ts`) — the query behind the homepage grid — filters
on exactly one thing:

```ts
.from('spots').select('*').eq('status', 'approved').order('work_score', …)
```

It never references `workability_score`. "Unfit" is **not** a status — it's a low
`workability_score` (0–10) written by the Curator (`scripts/curate-workability.ts`),
which never touches `status`. So a spot the Curator judged unfit stays
`status='approved'` and stays live.

Meanwhile the `/find` recommender (`src/lib/labs/retriever.ts`) **does** enforce
fitness: `WORKABILITY_STRICT_MIN = 6`, relaxed floor 4, nulls excluded in strict.
The same `6` bar lives in `scripts/cafelist-quality-gate.ts`. The homepage is the
only read surface that ignores it. That's the contract mismatch.

The card (`SpotCard.tsx`) hides the score badge for `workability_score < 4`
("no need to advertise a 2.5"), so unfit spots don't get filtered — they just
render **unlabeled**. Those are the score-less cards in the grid.

### 1b. The content came from a bulk backfill that got approved past the bar
The 2026-05-25 `flood-nyc.ts` import was designed to insert as `status='pending'`
for the Curator to score. In production those rows ended up **approved** in bulk
without the workability bar applied.

Live (`status='approved'`) counts, project `groundwork`:

| Batch (created_at) | Approved | Unfit (<4) | Below bar (<6) | Avg workability |
|---|---|---|---|---|
| 2026-05-25 (flood) | 306 | 96 | 202 | 5.24 |
| 2026-05-02 (initial) | 147 | 5 | 74 | 5.96 |
| **Total** | **453** | **101** | **276** | — |

So **61% of the live grid is below the fitness bar** the rest of the product
already enforces, and **101 spots (22%) are outright unfit**. The flood batch is
the bulk of it.

### 1c. Broken cover images are dead URLs, not missing data
Every approved spot has a non-empty `photos` value (0 missing). The gray cards
with the name bleeding through are **failed image loads** — alt-text over the
fallback surface — i.e. the stored Google Places photo URLs no longer resolve
(expired references / referrer-blocked hotlinks). This is a separate defect from
the fitness problem and needs its own fix.

---

## 2. Ingestion status — already stopped (no action needed)

- **Vercel Cron**: `vercel.json` `crons: []` — Scout was paused 2026-05-25 during
  the flood backfill. Nothing scheduled.
- **Cowork scheduled task** `cafelist-scout-agent`: `enabled: false`.
- **Insert history**: only two batches ever (2026-05-02, 2026-05-25). No drip
  ingestion since.

Conclusion: no automated ingestion is running. The only way new shops enter today
is a manual script run (`flood-nyc.ts`, `scout.ts`, `import-nyc.ts`,
`add-targeted-spots.ts`). **Recommended guardrail: do not re-enable Scout cron and
do not run any import script until the gate in §4 is in place.**

---

## 3. The fix for 1a (homepage fitness gate)

Minimal, contract-aligned change — make the homepage honor the same bar the
recommender and quality-gate already use.

- In `getSpots()` add a workability floor to the published query, e.g.
  `.gte('workability_score', 6)` (strict) — matching `WORKABILITY_STRICT_MIN`.
- Decide null handling: exclude unscored rows from the public grid (Curator
  catches them within 24h), consistent with the retriever's strict pass.
- Factor the `6` into one shared constant so the homepage, retriever, and
  quality-gate can't drift again.
- Leave `SpotCard`'s badge-hiding as-is; once the gate is in place there are no
  sub-4 spots reaching it anyway.

Impact at current data: grid drops from 453 → ~177 strict-fit spots. If that's too
thin per neighborhood, use the relaxed floor (4) for the grid while keeping `/find`
strict — a product call, not a technical constraint.

> Not implemented in this pass — proposal only.

---

## 4. Quality-refinement plan (sequenced)

**Step 1 — Audit, don't guess.** Run the existing read-only gate:
`npx tsx scripts/cafelist-quality-gate.ts --summary`. It already emits per-spot
verdicts (`publish | hold | review | reject`) against `QUALITY_BAR.md` and writes
to `ops/reports/` + `ops/queues/`. This is the worklist.

**Step 2 — Demote the sub-bar backlog.** For the 276 below-6 approved rows, move
the clearly-unfit (the 101 <4) out of `approved` (to `rejected` or a new
`archived` status) so they leave the grid immediately. Triage the 4–6 band
(`hold`) by hand or with a Curator re-score pass (`--force`).

**Step 3 — Ship the homepage gate (§3)** so cleanup can't silently regress and new
approvals are bounded by the same bar.

**Step 4 — Fix broken images (1c).** Confirm the failure mode (inspect a card's
photo URL → expect 403/expired). Then either: re-fetch fresh Google Places photo
references at render via a server proxy, store a longer-lived asset, or
gracefully fall back to the Coffee icon when an image 404/403s instead of showing
alt-text. Backfill/repair photo URLs for the live set.

**Step 5 — Re-approval criteria (gate before publish).** Going forward a spot is
publishable only if: required fields present; `workability_score ≥ 6` and scored
≤90d; outlet/amenity claims backed by enrichment (`enriched_at`, confidence ≥0.6);
hours JSON parseable; coords valid; cover image resolves. This is already encoded
in `cafelist-quality-gate.ts` — the missing piece is **enforcing it at the
status→approved transition**, not just reporting on it.

**Step 6 — Guardrail before any re-ingestion.** Before Scout cron or a flood rerun:
imports insert `pending` only; nothing reaches `approved` except via the gate in
Step 5. No bulk-approve of an import batch.

---

## 5. Open product decisions for you

1. **Grid floor: strict (6) or relaxed (4)?** Strict = ~177 spots, higher trust,
   thinner neighborhoods. Relaxed = more coverage, some friction-y spots labeled
   "ok". (`/find` stays strict either way.)
2. **Demotion target for unfit rows:** reuse `rejected`, or add `archived` so
   `rejected` stays meaningful (trap-detector kills vs. editorial demotion)?
3. **Image strategy:** proxy-on-render vs. store durable assets — affects cost and
   the Places API budget.

---

## Appendix — verification queries (project `groundwork`)

```sql
-- live grid fitness distribution
select count(*) total_approved,
  count(*) filter (where workability_score < 4) unfit_lt4,
  count(*) filter (where workability_score < 6) below_bar,
  count(*) filter (where workability_score >= 6) fit_strict
from spots where status='approved';
-- → 453 total, 101 <4, 276 <6, 177 ≥6

-- photo coverage (data present; URLs are the problem)
select count(*) filter (where photos is null
  or jsonb_array_length(coalesce(photos,'[]'::jsonb))=0) as no_photos
from spots where status='approved';  -- → 0
```
