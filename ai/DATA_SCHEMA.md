# CafeList Data Schema Reference

Source of truth for what fields exist, what they mean, how reliable they are, and how agents should use them. Updated when migrations add new fields.

Supabase project: `ztvyuuvbxofumnyobxcs` (named "groundwork", us-east-1, Postgres 17)

---

## spots table — core fields

| Field | Type | Reliability | Notes |
|-------|------|-------------|-------|
| `id` | uuid | — | Primary key |
| `name` | text | High | From Google Places import |
| `slug` | text | High | URL-safe identifier |
| `type` | SpotType | Medium | coffee_shop / hotel_lobby / diner / bar / library / coworking / other |
| `address` | text | High | From Google Places |
| `city` | text | High | From import |
| `neighborhood` | text\|null | Medium | Hand-assigned or inferred; not always present |
| `lat` / `lng` | numeric\|null | High | From Google Places |
| `google_place_id` | text\|null | High | Dedup key for Scout |
| `hours` | JSONB\|null | Medium | Structured `{monday: {open, close}}`. **Null means unknown, not 24hr.** |
| `work_score` | numeric | Low–Medium | Aggregate of review ratings. Overstates bars/restaurants. Use `workability_score` instead. |
| `workability_score` | numeric(3,1)\|null | High (when present) | 0–10 Curator-assessed "can a remote worker camp 2+ hrs". Null = unscored. |
| `workability_reasoning` | text\|null | High | One-sentence Curator justification. Surfaces the key tradeoff. |
| `workability_scored_at` | timestamptz\|null | — | Staleness gate. >90d → needs rescore. |
| `has_wifi` | boolean | Medium | Reliable when from manual import; unreliable from Scout defaults |
| `has_outlets` | boolean | **Low** | Defaults to false. 90%+ of Scout-imported spots have false as a default, not a measurement. Check `enriched_at`. If null, treat as unknown. |
| `laptop_friendly` | boolean | Medium | More reliable than `has_outlets`; often inferred from vibe/reviews |
| `noise_level` | NoiseLevel\|null | Medium | silent / quiet / moderate / loud. Null = unassessed. |
| `vibe_tags` | text[] | Medium | Additive from multiple sources. Informative but not guaranteed. |
| `notes` | text\|null | Medium | Review text or editor notes. Source for enricher. |
| `status` | SpotStatus | High | pending / approved / rejected. Only approved spots surface to users. |
| `last_verified_at` | timestamptz\|null | High | Set when an admin approves or manually reviews. Null = never human-verified. |
| `enriched_at` | timestamptz\|null | — | Set by enricher script. Null = enricher hasn't run on this spot. |
| `enrichment_signals` | JSONB\|null | High (when present) | Raw enricher output: per-field {value, confidence, evidence}. Audit trail. |

---

## spots table — score fields

These are computed from user reviews (star ratings). They reflect what reviewers valued, not actual workability.

| Field | Range | Meaning | Reliability for work queries |
|-------|-------|---------|------------------------------|
| `work_score` | 0–10 | Aggregate of wifi + outlet + seating ratings | Low — bars/restaurants inflate it |
| `late_night_score` | 0–10 | Based on late_night_rating in reviews | Medium |
| `wifi_score` | 0–10 | Based on wifi_rating | Medium |
| `outlet_score` | 0–10 | Based on outlet_rating | Low — infrequently reviewed |
| `noise_score` | 0–10 | Based on noise_rating | Medium |
| `seating_score` | 0–10 | Based on seating_rating | Medium |

**Rule:** Use `workability_score` for work-query ranking and filtering. Use `work_score` only as a tiebreaker when `workability_score` is null.

---

## Key agent tables

### agent_query_logs
Logs every `/labs` query. Key fields: `query`, `neighborhood`, `city`, `mode`, `mode_freeform`, `failure_mode`, `created_at`. Used by Coverage Gap agent to prioritize Scout. The `failure_mode` field tells you why a query returned weak results.

### scout_runs
Logs each Scout invocation. Fields: `run_id`, `started_at`, `status`, `city`, `neighborhood`, `candidates_examined`, `candidates_inserted`, `total_cost_usd`, `error_message`.

### scout_priority
Drives Scout's city/neighborhood rotation. Fields: `city`, `neighborhood`, `priority_score`, `source` (manual / coverage_gap / backfill), `last_scouted_at`.

### agent_eval_cases, agent_eval_runs, agent_eval_results
Eval harness for the /labs pipeline. Don't modify directly — use `npm run eval`.

### agent_prompt_runs
Prompt optimizer audit trail. Don't modify directly — use `npm run optimize:prompt`.

---

## Reliability tiers for agent use

**Tier 1 — Trust directly:** `workability_score` (when not null), `workability_reasoning`, `last_verified_at` (when not null), `hours` (when not null), `name`, `address`, `google_place_id`, `type`.

**Tier 2 — Trust with caveat:** `has_wifi`, `laptop_friendly`, `noise_level`, `vibe_tags`, `work_score`. Caveat: data quality varies by import source. Mention source confidence when surfacing these to users.

**Tier 3 — Verify before asserting:** `has_outlets`. Always check `enriched_at` and `enrichment_signals.outlets.confidence`. If `enriched_at` is null, label as "outlet status unknown" not "no outlets." Never use `has_outlets=false` as a negative claim to users.

**Tier 4 — Do not use alone:** `work_score` for any workability claim. It over-rates food venues. Always pair with `workability_score` or `laptop_friendly`.

---

## Confidence vocabulary

When surfacing data to users or in agent outputs, use this vocabulary:

- **Confirmed** — `last_verified_at` is set, field has a non-default value
- **Likely** — enricher confidence ≥ 0.7, `enriched_at` is set
- **Reported** — from vibe_tags or notes text, not a structured field
- **Unknown** — field is null or is a default value without enricher confirmation
- **Conflicting signals** — multiple sources disagree; needs manual review

Never use "confirmed" when the data is from Scout defaults. Never use "likely" when `enriched_at` is null.
