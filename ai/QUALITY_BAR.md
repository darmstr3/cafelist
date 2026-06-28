# CafeList Quality Bar

Concrete thresholds that gate every Growth OS output. These are not guidelines — they are pass/fail criteria. QA uses these to approve or block.

---

## Data quality thresholds

### For retriever / recommendation eligibility
- `status = 'approved'` — required
- `workability_score ≥ 6` — strict pass (retriever WORKABILITY_STRICT_MIN)
- `workability_score ≥ 4` OR `workability_score IS NULL` — relaxed pass (fallback only, must be labeled)
- `type = 'coffee_shop'` — required for Deep Work, Study, and most work queries

### For outlet claims
- `has_outlets = true` AND `enriched_at IS NOT NULL` AND `enrichment_signals.outlets.confidence ≥ 0.6` — "confirmed outlets"
- `has_outlets = true` AND `enriched_at IS NULL` — "outlets reported, not verified"
- `has_outlets = false` AND `enriched_at IS NULL` — "outlet status unknown" (not "no outlets")
- `has_outlets = false` AND `enrichment_signals.outlets.value = 'none'` AND confidence ≥ 0.6 — "no outlets confirmed"

### For hours claims
- Structured `hours` JSON with specific close time — use for hard filters and claims
- `vibe_tags` containing "late hours" without structured hours — "reportedly open late, verify before visiting"
- `hours IS NULL` — hours unknown, do not make hours claims

### For verification status
- `last_verified_at` within 90 days — "recently verified"
- `last_verified_at` within 180 days — "verified" (with date)
- `last_verified_at` older than 180 days — "last verified [date], may have changed"
- `last_verified_at IS NULL` — "not yet manually verified"

---

## SEO page quality gate

All five must be true for READY status:

| Check | Threshold |
|-------|-----------|
| Minimum qualifying spots | ≥ 3 with workability ≥ 6, status=approved |
| Claimed attributes confirmed | 0 spots featured with unverified key attribute |
| Hours data | All featured spots with hours claims have structured hours |
| Freshness | All featured spots verified within 180 days |
| Not duplicative | No existing page with ≥ 50% same spot list |

---

## Product proposal quality gate

| Check | Threshold |
|-------|-----------|
| User demand evidence | ≥ 1 concrete data point (query log pattern, user report, DB gap count) |
| User story completeness | Includes actor, action, outcome, acceptance criteria |
| Rollback plan | Specified (env flag / git revert / migration rollback) |
| Risk assessed | Explicit LOW / MEDIUM / HIGH with reasoning |

---

## Engineering implementation quality gate

| Check | Required |
|-------|----------|
| V2 changes gated | Behind `NEXT_PUBLIC_LABS_V2` or `LABS_V2_ENABLED` |
| Branch discipline | On `feat/*`, not directly on main |
| Rollback line | In PR description |
| No destructive migrations | Additive only; drops/renames require separate PR + 48h gap |
| Existing routes tested | Homepage, /labs, /admin/ops unaffected |

---

## Release quality gate

| Check | Required |
|-------|----------|
| PR merged | Yes |
| Production deployed | Confirmed (Vercel deploy status = READY) |
| No regressions | /api/health check clean, /labs still returns results |
| SHIP_LOG entry | Written and committed |
| CHANGELOG updated | Yes |

---

## Production safety rules

Copied from ADR-0004. Non-negotiable.

1. `main` = production. Vercel auto-deploys main to cafelist.app.
2. All V2 work on `feat/labs-*` branches with Vercel preview deploys.
3. `NEXT_PUBLIC_LABS_V2` and `LABS_V2_ENABLED` both OFF in prod until V2 is end-to-end ready.
4. Database changes are additive. No drops or renames without a separate migration PR and a 48-hour gap.
5. The current free-text `/labs` keeps working until V2 fully replaces it.
6. Every PR has a rollback line.

Growth OS changes (new `/admin/growth-os` page, `/ai/` files) are additive and exempt from the V2 flag requirement. They are not user-facing.
