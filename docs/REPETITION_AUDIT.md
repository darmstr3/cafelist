# CafeList Repetition Audit

_Generated: 2026-06-13 | Rule: Manual once for learning. Systemized on the second occurrence. Automated only when verifiable. Human review reserved for exceptions and judgment._

Read this before starting any recurring task. If the task appears here, the associated system is your starting point — do not do it from scratch.

---

## Summary

| Category | Tasks Audited | Fully Automated | Partially Automated | Manual + Documented | Still Requires Human |
|---|---|---|---|---|---|
| Data Acquisition | 9 | 2 | 3 | 2 | 2 |
| Data Enrichment | 10 | 1 | 2 | 4 | 3 |
| Data Quality | 10 | 0 | 3 | 3 | 4 |
| Product Work | 8 | 0 | 1 | 4 | 3 |
| SEO | 8 | 0 | 1 | 4 | 3 |
| Content | 6 | 0 | 0 | 3 | 3 |
| Analytics & Growth | 6 | 0 | 1 | 3 | 2 |
| Operations | 7 | 0 | 2 | 3 | 2 |
| **Total** | **64** | **3** | **13** | **26** | **22** |

---

## Data Acquisition

### DA-01 — Discover new café candidates
- **Trigger:** Neighborhood expansion decision, coverage gap report, or Scout cron
- **Frequency:** Every 4 hours (automated city rotation)
- **Current method:** Scout agent via `npm run scout` / Vercel Cron `/api/scout`
- **Current manual effort:** Minimal; Scout picks city from `scout_priority` table
- **Risk if automated:** Low — spots land in `status='pending'` and are not published until Curator + human approval
- **Verification method:** `scout_runs` table logs outcome, cost, and count
- **Recommended system:** **AUTOMATED** — Vercel Cron at 4h interval. See `LEVERAGE_REGISTRY.md → Scout Loop`
- **Human review requirement:** No (discovery only; publishing requires Curator + approval)
- **Priority:** ✅ Done
- **Status:** Automated / Monitored

---

### DA-02 — Import bulk spot lists (e.g., NYC dataset)
- **Trigger:** New data source acquisition, neighborhood expansion
- **Frequency:** Occasional (not routine)
- **Current method:** `npm run import:nyc` / `scripts/import-nyc.ts`
- **Current manual effort:** Moderate — requires data file prep and review
- **Risk if automated:** High — bulk imports can create thousands of duplicates
- **Verification method:** `--dry-run` flag; duplicate check on `google_place_id`
- **Recommended system:** Script exists. Add pre-import duplicate scan. Run `cafelist:find-duplicates` first.
- **Human review requirement:** Yes — approve batch size and review dry-run output before live run
- **Priority:** Medium
- **Status:** Partially Automated

---

### DA-03 — Deduplicate spot records
- **Trigger:** After any bulk import; periodic hygiene check
- **Frequency:** After every import + monthly pass
- **Current method:** Manual inspection or scout dedup on `google_place_id` only
- **Current manual effort:** High — no dedicated dedup script existed
- **Risk if automated:** High — incorrect merges destroy data and break user favorites
- **Verification method:** Similarity threshold + human approval before any merge; coordinate proximity check
- **Recommended system:** `npm run cafelist:find-duplicates` → writes `ops/queues/duplicate-candidates.json` → human reviews queue
- **Human review requirement:** Yes — no automatic merges ever
- **Priority:** High
- **Status:** ✅ **Implemented** (see `scripts/cafelist-find-duplicates.ts`)

---

### DA-04 — Detect closed or relocated businesses
- **Trigger:** Scout updates, user reports, stale data pass
- **Frequency:** Monthly or on user report
- **Current method:** Manual; no systematic detection
- **Current manual effort:** High — no tooling
- **Risk if automated:** Medium — false positives would remove real spots
- **Verification method:** Google Places API `permanently_closed` flag + `business_status`; cross-reference with `last_verified_at`
- **Recommended system:** Add `business_status` check to Scout update pass; flag in `ops/queues/manual-review.json` rather than auto-delete
- **Human review requirement:** Yes — do not auto-reject based on API alone
- **Priority:** Medium
- **Status:** Manual — Documented

---

### DA-05 — Refresh structured hours
- **Trigger:** Hours data is null or older than 90 days
- **Frequency:** Continuous (stale gate in enricher / curator)
- **Current method:** Scout re-queries Google Places for updated spots; no dedicated hours refresh pass
- **Current manual effort:** Moderate
- **Risk if automated:** Low — hours are factual, not subjective
- **Verification method:** Compare new hours to existing; flag reversals (café was open late, now closes at 6pm) for human review
- **Recommended system:** Extend `enrich-spots.ts` with a `--refresh-hours` mode that calls Google Places for spots with stale hours
- **Human review requirement:** Only for significant changes (hours shortened by 3+ hours)
- **Priority:** Medium
- **Status:** Partially Automated (incidental via Scout)

---

### DA-06 — Retrieve/refresh photos
- **Trigger:** Spot has no photos or photos older than 180 days
- **Frequency:** Low — photos rarely change
- **Current method:** From Google Places import; no refresh pass
- **Current manual effort:** Low (photos often sufficient from import)
- **Risk if automated:** Low
- **Verification method:** URL validity check; minimum one valid photo URL
- **Recommended system:** Add broken image URL check to `cafelist:quality-gate`; batch photo refresh as separate occasional script
- **Human review requirement:** No, for URL validity; yes for editorial photo selection
- **Priority:** Low
- **Status:** Manual — Documented

---

### DA-07 — Assign/verify neighborhood for spots
- **Trigger:** New spot import with null neighborhood
- **Frequency:** After every Scout run (5–20% of new spots lack a neighborhood)
- **Current method:** Manual inspection or not done
- **Current manual effort:** High if done manually
- **Risk if automated:** Medium — neighborhood assignment affects SEO pages and filters
- **Verification method:** Coordinate-based reverse geocoding via Google Geocoding API; cross-reference with existing neighborhood list in `src/lib/labs/neighborhoods.ts`
- **Recommended system:** Add neighborhood inference step to enricher for spots with `neighborhood IS NULL`
- **Human review requirement:** Yes for ambiguous boundaries (e.g. spot on edge between two hoods)
- **Priority:** Medium
- **Status:** Manual — Documented

---

### DA-08 — Identify chains vs. independent cafés
- **Trigger:** Import of large datasets
- **Frequency:** After bulk imports
- **Current method:** Not currently differentiated in schema
- **Current manual effort:** High
- **Risk if automated:** Low — this is metadata, not a decision
- **Verification method:** Name pattern matching + Google Places `types` array
- **Recommended system:** Add `is_chain` boolean field + inference during enrichment
- **Human review requirement:** Only for borderline cases
- **Priority:** Low
- **Status:** Manual — Documented

---

### DA-09 — Track source and freshness per field
- **Trigger:** Any import or enrichment
- **Frequency:** Continuous
- **Current method:** `enrichment_signals` JSONB + `enriched_at` + `last_verified_at` timestamps
- **Current manual effort:** Low — already tracked
- **Risk if automated:** Low
- **Verification method:** Schema enforced
- **Recommended system:** Already implemented in data schema. Use `cafelist:check-stale` to surface stale records.
- **Human review requirement:** No
- **Priority:** ✅ Done
- **Status:** Automated / Monitored

---

## Data Enrichment

### DE-01 — Extract workability signals from review text
- **Trigger:** New spot imported; existing spot `enriched_at` older than 90 days
- **Frequency:** Daily (incremental) + 90-day stale refresh
- **Current method:** `npm run enrich` / `scripts/enrich-spots.ts`
- **Current manual effort:** Minimal — script handles full pass
- **Risk if automated:** Low — enricher writes to `enrichment_signals` with confidence; Curator reads confidently
- **Verification method:** `enrichment_signals.{field}.confidence` threshold; spot-check against raw `notes`
- **Recommended system:** **AUTOMATED** — runs before Curator in the daily loop. Confirmed idempotent.
- **Human review requirement:** No, for structured signals. Yes for flagged conflicting evidence.
- **Priority:** ✅ Done
- **Status:** Automated

---

### DE-02 — Score workability (Curator)
- **Trigger:** New approved spot; workability_scored_at > 90 days
- **Frequency:** Daily at 04:03 UTC
- **Current method:** `npm run curate:workability` / Vercel Cron
- **Current manual effort:** Minimal
- **Risk if automated:** Medium — subjective score; LLM output should be graded
- **Verification method:** Score in range 0–10; reasoning non-empty; no score > 8 for spots with null `has_wifi`
- **Recommended system:** **AUTOMATED** — already running. Checker: range validation + reasoning length check in `cafelist:quality-gate`
- **Human review requirement:** Spot-check when score changes by > 3 from previous value
- **Priority:** ✅ Done
- **Status:** Automated / Monitored

---

### DE-03 — Assess noise level
- **Trigger:** Spot with `noise_level IS NULL` or enrichment stale
- **Frequency:** With enrichment pass
- **Current method:** Enricher infers from review text (quiet/moderate/loud)
- **Current manual effort:** None if enricher runs
- **Risk if automated:** Low — enricher labels source and confidence
- **Verification method:** One of: silent / quiet / moderate / loud; confidence ≥ 0.6
- **Recommended system:** Already in enricher. Surface nulls in `cafelist:check-stale`.
- **Human review requirement:** Only for conflicting signals in enrichment_signals
- **Priority:** Medium
- **Status:** Partially Automated

---

### DE-04 — Verify outlet availability
- **Trigger:** has_outlets=false with enriched_at IS NULL (unreliable Scout default)
- **Frequency:** One-time backfill + 90-day refresh
- **Current method:** Enricher mines notes; flagged as chronically unreliable in DATA_SCHEMA.md
- **Current manual effort:** High without enricher
- **Risk if automated:** Medium — `has_outlets=false` as default ≠ confirmed no outlets
- **Verification method:** enrichment_signals.outlets.confidence ≥ 0.6 AND enriched_at IS NOT NULL
- **Recommended system:** Enricher handles. `cafelist:quality-gate` blocks outlet claims where evidence is weak.
- **Human review requirement:** When claim is made to users
- **Priority:** ✅ Handled by enricher + quality gate
- **Status:** Partially Automated

---

### DE-05 — Assess Wi-Fi quality
- **Trigger:** New spots; stale enrichment
- **Frequency:** With enrichment pass
- **Current method:** Scorer in `src/lib/scorer.ts` + enricher
- **Current manual effort:** None
- **Risk if automated:** Low
- **Verification method:** wifi_score range; enrichment_signals.wifi.confidence
- **Recommended system:** Already automated. Surface low-confidence wifi claims in quality gate.
- **Human review requirement:** No
- **Priority:** ✅ Done
- **Status:** Automated

---

### DE-06 — Verify laptop policy
- **Trigger:** New spot; user report of policy change
- **Frequency:** Low — policies rarely change
- **Current method:** Inferred from vibe_tags and notes
- **Current manual effort:** Low
- **Risk if automated:** Medium — policy changes and AI inference may be stale
- **Verification method:** Review text evidence in notes; vibe_tags
- **Recommended system:** Add to quality gate as "Tier 3 — verify before asserting"
- **Human review requirement:** Yes for spots with explicit "no laptop" policy claims
- **Priority:** Low
- **Status:** Manual — Documented

---

### DE-07 — Assess seating quality
- **Trigger:** Enrichment pass
- **Frequency:** With enrichment
- **Current method:** Inferred from review text
- **Current manual effort:** None
- **Risk if automated:** Low
- **Verification method:** Evidence in notes
- **Recommended system:** Part of enricher. Surface null seating in quality gate for featured spots.
- **Human review requirement:** No
- **Priority:** Low
- **Status:** Partially Automated

---

### DE-08 — Assess suitability for calls, interviews, group work
- **Trigger:** Mode-specific recommendation request
- **Frequency:** Per recommendation query
- **Current method:** Inferred from noise_level + type + vibe_tags via fit-scorer
- **Current manual effort:** None — deterministic scorer
- **Risk if automated:** Low
- **Verification method:** Fit-scorer deterministic; eval harness catches regressions
- **Recommended system:** Already in `fit-scorer.ts`. Eval harness is the checker.
- **Human review requirement:** No, unless eval regression detected
- **Priority:** ✅ Done
- **Status:** Automated

---

### DE-09 — Refresh enrichment for stale spots (90-day pass)
- **Trigger:** enriched_at < now - 90d
- **Frequency:** Quarterly or when coverage-gap signals stale data
- **Current method:** `npm run enrich` picks up stale rows automatically
- **Current manual effort:** Low — just run the script
- **Risk if automated:** Low
- **Verification method:** enriched_at updated; signals non-empty
- **Recommended system:** `cafelist:check-stale` surfaces the queue. Enricher handles the refresh.
- **Human review requirement:** No
- **Priority:** ✅ Handled
- **Status:** Partially Automated

---

### DE-10 — Enrich food/coffee quality fields
- **Trigger:** Spot with no quality signals beyond workability
- **Frequency:** Low — these are secondary attributes
- **Current method:** From Google rating; not structurally enriched
- **Current manual effort:** High — no dedicated field or script
- **Risk if automated:** Medium — food quality inferred from reviews can be noisy
- **Verification method:** Review evidence; reviewer count threshold
- **Recommended system:** Extend enricher with food/coffee quality extraction (optional future pass)
- **Human review requirement:** Yes for featured claims
- **Priority:** Low
- **Status:** Manual — Documented

---

## Data Quality

### DQ-01 — Check for missing required fields
- **Trigger:** Before publication; after Scout run
- **Frequency:** Continuous
- **Current method:** No dedicated script; Curator rejects low-scoring spots implicitly
- **Current manual effort:** High — requires manual inspection
- **Risk if automated:** Low
- **Verification method:** Deterministic field presence checks
- **Recommended system:** `npm run cafelist:quality-gate` — checks required fields per QUALITY_BAR.md
- **Human review requirement:** No for detection; yes for remediation decisions
- **Priority:** High
- **Status:** ✅ **Implemented** (see `scripts/cafelist-quality-gate.ts`)

---

### DQ-02 — Detect conflicting field values
- **Trigger:** Enrichment produces result conflicting with existing data
- **Frequency:** With enrichment pass
- **Current method:** enrichment_signals includes a `conflicting` flag
- **Current manual effort:** High — no surfacing mechanism
- **Risk if automated:** Medium — resolution requires judgment
- **Verification method:** enrichment_signals[field].conflicting = true
- **Recommended system:** `cafelist:quality-gate` writes conflicting spots to `ops/queues/manual-review.json`
- **Human review requirement:** Yes — always
- **Priority:** High
- **Status:** Partially Automated

---

### DQ-03 — Flag stale data records
- **Trigger:** workability_scored_at, enriched_at, or last_verified_at past threshold
- **Frequency:** Weekly
- **Current method:** No dedicated script; thresholds defined in schema docs but not enforced
- **Current manual effort:** High
- **Risk if automated:** Low
- **Verification method:** Timestamp comparisons; deterministic
- **Recommended system:** `npm run cafelist:check-stale` — surfaces queue of stale records
- **Human review requirement:** No for detection; yes for deciding which to re-enrich vs. retire
- **Priority:** High
- **Status:** ✅ **Implemented** (see `scripts/cafelist-check-stale.ts`)

---

### DQ-04 — Find duplicate spot records
- **Trigger:** After bulk imports; periodic hygiene
- **Frequency:** After each import + monthly
- **Current method:** Only google_place_id dedup in Scout; no coordinate or name similarity pass
- **Current manual effort:** High
- **Risk if automated:** High — incorrect merges are destructive
- **Verification method:** Name similarity + coordinate proximity; human approval required
- **Recommended system:** `npm run cafelist:find-duplicates` → `ops/queues/duplicate-candidates.json`
- **Human review requirement:** Yes — always before any merge
- **Priority:** High
- **Status:** ✅ **Implemented** (see `scripts/cafelist-find-duplicates.ts`)

---

### DQ-05 — Validate coordinates
- **Trigger:** Import; enrichment
- **Frequency:** With each data import
- **Current method:** Not validated; null coordinates pass through
- **Current manual effort:** Low
- **Risk if automated:** Low
- **Verification method:** lat in [-90, 90], lng in [-180, 180]; not (0, 0)
- **Recommended system:** Add coordinate validation to `cafelist:quality-gate`
- **Human review requirement:** No for detection; yes for fixing
- **Priority:** Medium
- **Status:** Partially Automated (in quality gate)

---

### DQ-06 — Check for broken image URLs
- **Trigger:** Periodic; before SEO page creation
- **Frequency:** Monthly
- **Current method:** None
- **Current manual effort:** High
- **Risk if automated:** Low
- **Verification method:** HTTP HEAD request to photo URLs; 200 = valid
- **Recommended system:** Add to `cafelist:quality-gate` as a low-priority check; batch HTTP checks
- **Human review requirement:** No for detection; yes for sourcing replacements
- **Priority:** Low
- **Status:** Manual — Documented

---

### DQ-07 — Validate structured hours format
- **Trigger:** Import; enrichment; any hours update
- **Frequency:** With data ingestion
- **Current method:** Parser in `scorer.ts` handles known formats; malformed hours silently fail
- **Current manual effort:** Moderate
- **Risk if automated:** Low — deterministic parsing
- **Verification method:** Hours JSON parseable; close time > open time; days present
- **Recommended system:** Add hours validation to `cafelist:quality-gate`
- **Human review requirement:** No for detection; yes for repair
- **Priority:** Medium
- **Status:** Partially Automated (in quality gate)

---

### DQ-08 — Identify unsupported subjective claims
- **Trigger:** Before publication; before SEO page creation
- **Frequency:** With publication workflow
- **Current method:** QUALITY_BAR.md defines thresholds; not programmatically enforced
- **Current manual effort:** High
- **Risk if automated:** Low — checks are deterministic threshold tests
- **Verification method:** enriched_at, confidence thresholds per QUALITY_BAR.md
- **Recommended system:** `cafelist:quality-gate` enforces QUALITY_BAR.md thresholds
- **Human review requirement:** Yes — to decide whether to surface as "Likely" vs. "Confirmed"
- **Priority:** High
- **Status:** ✅ **Implemented** (in quality gate)

---

### DQ-09 — Identify publication-ready vs. hold records
- **Trigger:** Curator completes a scoring pass
- **Frequency:** Daily (after Curator runs)
- **Current method:** Manual inspection of Supabase
- **Current manual effort:** High
- **Risk if automated:** Medium — requires all quality checks to pass
- **Verification method:** All QUALITY_BAR.md checks pass; not in duplicate queue
- **Recommended system:** `cafelist:quality-gate` outputs per-record verdict
- **Human review requirement:** Yes for "Review" verdict; no for auto-pass "Publish" or auto-hold "Hold"
- **Priority:** High
- **Status:** ✅ **Implemented** (in quality gate)

---

### DQ-10 — Detect suspicious/implausible scores
- **Trigger:** After Curator pass
- **Frequency:** With each Curator run
- **Current method:** None
- **Current manual effort:** High
- **Risk if automated:** Low
- **Verification method:** workability_score > 9 with no wifi evidence; score changed by > 3; score > 6 with noise_level = loud
- **Recommended system:** Add anomaly rules to `cafelist:quality-gate`
- **Human review requirement:** Yes
- **Priority:** Medium
- **Status:** Partially Automated (in quality gate)

---

## Product Work

### PW-01 — Debug repeated API/route errors
- **Trigger:** Error report, health check, user report
- **Frequency:** Sporadic; certain errors recur (getSpots 522, query log writes)
- **Current method:** Manual inspection; noted in DECISION_LOG and JOURNAL
- **Current manual effort:** High — starts from scratch each time
- **Risk if automated:** Low (detection only)
- **Verification method:** `/api/health` + known error patterns
- **Recommended system:** `npm run cafelist:build-check` — runs lint + tsc + build + health endpoint check; document findings in `ops/decisions/decision-log.md`
- **Human review requirement:** Yes for fix decisions
- **Priority:** High
- **Status:** Partially Automated (manual + documented pattern)

---

### PW-02 — Verify authentication works
- **Trigger:** After auth-touching deploys; periodic smoke test
- **Frequency:** Weekly or after deploy
- **Current method:** Manual click-through
- **Current manual effort:** Moderate
- **Risk if automated:** Low
- **Verification method:** Admin Basic Auth middleware returns 401 for unknown credentials; /admin/* routes protected
- **Recommended system:** Add admin auth check to `cafelist:build-check`
- **Human review requirement:** No for detection; yes for fix
- **Priority:** Medium
- **Status:** Manual — Documented

---

### PW-03 — Check empty states and error states
- **Trigger:** New features; after data changes (e.g., city with no coverage)
- **Frequency:** With each feature release
- **Current method:** Manual; eval harness checks empty-state text for /labs
- **Current manual effort:** Moderate
- **Risk if automated:** Low
- **Verification method:** Eval harness case for zero-result queries
- **Recommended system:** Extend eval harness with empty-state cases; results visible in /labs/eval
- **Human review requirement:** No for detection; yes for copy changes
- **Priority:** Medium
- **Status:** Partially Automated (eval harness)

---

### PW-04 — Add new filters/categories
- **Trigger:** User demand signal; coverage gap
- **Frequency:** Occasional
- **Current method:** Manual code + data change
- **Current manual effort:** High
- **Risk if automated:** N/A — design decisions require human judgment
- **Verification method:** Eval case for new filter; build check; type check
- **Recommended system:** Define filter taxonomy in a single config file; new filters = 1 config + 1 eval case
- **Human review requirement:** Yes — product decision
- **Priority:** Medium
- **Status:** Manual — Documented (requires human judgment)

---

### PW-05 — Build new neighborhood pages
- **Trigger:** Neighborhood expansion loop; coverage threshold met
- **Frequency:** Occasional (when quality bar met)
- **Current method:** Manual code; no template
- **Current manual effort:** High
- **Risk if automated:** Medium — page creation without quality gate = thin content
- **Verification method:** SEO quality gate (≥ 3 spots with workability ≥ 6); no duplicate page
- **Recommended system:** `ops/templates/seo-page.md` template + quality gate check before creation
- **Human review requirement:** Yes — before any new page goes live
- **Priority:** High
- **Status:** Manual — Documented

---

### PW-06 — Update UI patterns consistently
- **Trigger:** Design changes; new components
- **Frequency:** Occasional
- **Current method:** Manual; BRAND_AND_DESIGN_BRIEF.md exists
- **Current manual effort:** Moderate
- **Risk if automated:** N/A
- **Verification method:** Visual comparison; lint + type check
- **Recommended system:** Component library in `src/components/ui/`; design brief as reference
- **Human review requirement:** Yes
- **Priority:** Low
- **Status:** Manual — Documented

---

### PW-07 — Test mobile behavior
- **Trigger:** After UI changes; before release
- **Frequency:** Per release
- **Current method:** Manual browser resize
- **Current manual effort:** Moderate
- **Risk if automated:** Low
- **Verification method:** Build check at mobile viewport
- **Recommended system:** Add viewport test cases to eval harness; document in OPERATING_GUIDE
- **Human review requirement:** Yes
- **Priority:** Low
- **Status:** Manual — Documented

---

### PW-08 — Review PR quality and safety
- **Trigger:** Before any merge to main
- **Frequency:** Every PR
- **Current method:** Manual self-review against QUALITY_BAR.md checklist
- **Current manual effort:** Moderate
- **Risk if automated:** Medium — CI catches mechanical issues but not design decisions
- **Verification method:** CI runs lint + tsc; PR template covers manual checks
- **Recommended system:** `.github/PULL_REQUEST_TEMPLATE.md` exists; GitHub Actions CI in place; checklist enforced
- **Human review requirement:** Yes — always
- **Priority:** ✅ Done
- **Status:** Automated (CI) + Documented (template)

---

## SEO

### SEO-01 — Create neighborhood landing pages
- **Trigger:** Neighborhood meets quality bar (≥ 3 spots, workability ≥ 6)
- **Frequency:** Occasional — when new neighborhoods reach threshold
- **Current method:** Manual code
- **Current manual effort:** High
- **Risk if automated:** High — thin pages hurt SEO trust
- **Verification method:** SEO quality gate (all 5 conditions in SEO_RULES.md)
- **Recommended system:** `cafelist:quality-gate --seo` checks neighborhood readiness; `ops/templates/seo-page.md` for structure
- **Human review requirement:** Yes — always before publication
- **Priority:** High
- **Status:** Manual — Documented

---

### SEO-02 — Write page metadata
- **Trigger:** New page creation or metadata staleness
- **Frequency:** With each new page; quarterly refresh
- **Current method:** Manual; SEO_RULES.md defines rules
- **Current manual effort:** Moderate
- **Risk if automated:** Medium — must not generate duplicate titles
- **Verification method:** 50–60 char title; 150–160 char description; canonical set
- **Recommended system:** Metadata template in `ops/templates/seo-page.md`; deterministic rules from SEO_RULES.md
- **Human review requirement:** Yes for final copy
- **Priority:** Medium
- **Status:** Manual — Documented

---

### SEO-03 — Generate internal links
- **Trigger:** New page or spot created
- **Frequency:** With each new page/spot
- **Current method:** Manual
- **Current manual effort:** Moderate
- **Risk if automated:** Low — links are deterministic given page inventory
- **Verification method:** Link to `/spot/[slug]` exists; neighborhood page linked where it exists
- **Recommended system:** Auto-generate internal link list from spot/neighborhood index at build time
- **Human review requirement:** No for structure; yes for editorial links
- **Priority:** Medium
- **Status:** Manual — Documented

---

### SEO-04 — Detect duplicate or thin pages
- **Trigger:** Before page creation; periodic audit
- **Frequency:** With each new page; monthly audit
- **Current method:** Manual
- **Current manual effort:** High
- **Risk if automated:** Low
- **Verification method:** Spot-list overlap check (≥ 50% same = duplicate per SEO_RULES.md)
- **Recommended system:** Add to `cafelist:quality-gate --seo`; check proposed page against existing pages
- **Human review requirement:** Yes — to merge or retire
- **Priority:** High
- **Status:** Partially Automated (in quality gate)

---

### SEO-05 — Audit for stale pages needing refresh or noindex
- **Trigger:** last_verified_at or enriched_at > 90 days for featured spots
- **Frequency:** Monthly
- **Current method:** No process
- **Current manual effort:** High
- **Risk if automated:** Low — detection only
- **Verification method:** Featured spot freshness check per SEO_RULES.md §4
- **Recommended system:** `cafelist:check-stale` includes SEO-relevance flag; stale-featured pages go to ops/queues/content-review.json
- **Human review requirement:** Yes — to decide refresh vs. noindex vs. retire
- **Priority:** Medium
- **Status:** Partially Automated (in check-stale)

---

### SEO-06 — Find pages with thin content
- **Trigger:** Periodic audit; Google Search Console data
- **Frequency:** Monthly
- **Current method:** No process
- **Current manual effort:** High
- **Risk if automated:** Low
- **Verification method:** Spot count < 3 OR no workability_score on any featured spot
- **Recommended system:** Add to `cafelist:quality-gate --seo`
- **Human review requirement:** Yes
- **Priority:** Medium
- **Status:** Manual — Documented

---

### SEO-07 — Analyze search queries for opportunity
- **Trigger:** Weekly
- **Frequency:** Weekly (when Google Search Console data is available)
- **Current method:** Manual GSC review
- **Current manual effort:** High
- **Risk if automated:** Medium — requires correct interpretation of intent
- **Recommended system:** Weekly growth review loop (`ops/reports/weekly-growth.md`)
- **Human review requirement:** Yes — always
- **Priority:** Medium
- **Status:** Manual — Documented (requires human judgment)

---

### SEO-08 — Submit/update sitemap
- **Trigger:** New pages created; major content changes
- **Frequency:** With page creation or deletion
- **Current method:** Unknown — not documented
- **Current manual effort:** Unknown
- **Recommended system:** Auto-generate sitemap at build time; document submission process
- **Human review requirement:** No for generation; yes for submission decision
- **Priority:** Medium
- **Status:** Manual — Documented

---

## Content

### CO-01 — Write café summaries and workability reasoning
- **Trigger:** New approved spot; stale reasoning (> 90 days)
- **Frequency:** With each Curator pass
- **Current method:** Curator generates `workability_reasoning` via LLM
- **Current manual effort:** None
- **Risk if automated:** Medium — LLM may produce generic or inaccurate text
- **Verification method:** Reasoning references actual field values; non-empty; < 100 words
- **Recommended system:** Already automated in Curator. Quality gate checks reasoning non-empty.
- **Human review requirement:** No, unless reasoning is flagged as generic or incorrect
- **Priority:** ✅ Done
- **Status:** Automated

---

### CO-02 — Write neighborhood introductions
- **Trigger:** New neighborhood page created
- **Frequency:** With each new neighborhood page
- **Current method:** Manual
- **Current manual effort:** High
- **Risk if automated:** High — AI-written neighborhood copy is the "slop" risk identified in SEO_RULES.md
- **Verification method:** No invented facts; references actual spot data; no AI-filler phrases
- **Recommended system:** `ops/templates/seo-page.md` provides structure and constraints; human writes the 2-3 intro sentences
- **Human review requirement:** Yes — always
- **Priority:** Medium
- **Status:** Manual — Documented (requires human judgment)

---

### CO-03 — Write weekly updates and ship log entries
- **Trigger:** End of week; feature shipped
- **Frequency:** Weekly
- **Current method:** Manual; SHIP_LOG.md and CHANGELOG.md templates defined in LABS_V2_PLAN.md
- **Current manual effort:** Moderate
- **Risk if automated:** Low — draft only, human reviews
- **Recommended system:** Draft from git log + closed PRs; scheduled task for Friday draft
- **Human review requirement:** Yes — always
- **Priority:** Medium
- **Status:** Manual — Documented

---

### CO-04 — Convert café data into social posts or guides
- **Trigger:** User demand; milestone; new neighborhood launch
- **Frequency:** Occasional
- **Current method:** Manual
- **Current manual effort:** High
- **Recommended system:** `ops/templates/` includes social post template; human selects data and personalizes
- **Human review requirement:** Yes — always
- **Priority:** Low
- **Status:** Manual — Documented

---

### CO-05 — Update content when underlying data changes
- **Trigger:** Café closes, hours change, workability_score changes significantly
- **Frequency:** Low per page; cumulative over time
- **Current method:** No process
- **Current manual effort:** High — discovering changes requires manual Supabase queries
- **Recommended system:** `cafelist:check-stale` flags spots featured on pages whose data has changed significantly; goes to `ops/queues/content-review.json`
- **Human review requirement:** Yes
- **Priority:** Medium
- **Status:** Partially Automated

---

### CO-06 — Produce "best cafes for X" editorial content
- **Trigger:** SEO opportunity identified; user demand
- **Frequency:** Occasional
- **Current method:** Manual
- **Current manual effort:** High
- **Recommended system:** Quality gate checks data readiness; `ops/templates/seo-page.md` for structure; human writes
- **Human review requirement:** Yes — always
- **Priority:** Low
- **Status:** Manual — Documented

---

## Analytics & Growth

### AG-01 — Review traffic and engagement
- **Trigger:** Weekly
- **Frequency:** Weekly
- **Current method:** Manual Google Analytics/Search Console review (when connected)
- **Current manual effort:** High
- **Recommended system:** `ops/reports/weekly-growth.md` template; weekly scheduled report
- **Human review requirement:** Yes — for decisions
- **Priority:** Medium
- **Status:** Manual — Documented

---

### AG-02 — Run coverage gap analysis
- **Trigger:** Weekly (Monday) + manual
- **Frequency:** Weekly
- **Current method:** `npm run coverage-gap` / Vercel Cron + reports in `reports/`
- **Current manual effort:** Minimal — script runs automatically; output reviewed manually
- **Risk if automated:** Low
- **Verification method:** scout_priority table updated; report written
- **Recommended system:** **PARTIALLY AUTOMATED** — Vercel Cron runs the script; report saved to `reports/`; ops dashboard shows last run
- **Human review requirement:** Yes — for interpreting priorities and overriding Scout queue
- **Priority:** ✅ Done
- **Status:** Partially Automated / Monitored

---

### AG-03 — Identify high-impression, low-click pages
- **Trigger:** GSC data available; weekly
- **Frequency:** Weekly
- **Current method:** Manual GSC review
- **Current manual effort:** High
- **Recommended system:** Part of weekly growth review loop
- **Human review requirement:** Yes
- **Priority:** Medium
- **Status:** Manual — Documented

---

### AG-04 — Find searches with no matching page
- **Trigger:** Query log analysis; GSC data
- **Frequency:** Weekly
- **Current method:** Coverage gap report (for /labs queries); no GSC integration
- **Current manual effort:** Moderate
- **Recommended system:** Coverage gap script already handles /labs queries; extend to GSC keyword data
- **Human review requirement:** Yes — for deciding whether to create new pages
- **Priority:** Medium
- **Status:** Partially Automated (/labs queries)

---

### AG-05 — Track returning usage and favorites
- **Trigger:** Analytics review
- **Frequency:** Weekly
- **Current method:** Not currently instrumented (site is fully anonymous)
- **Current manual effort:** N/A — data doesn't exist yet
- **Recommended system:** Add event logging (events table exists); analytics review in weekly report
- **Human review requirement:** Yes
- **Priority:** Low (blocked on auth/events implementation)
- **Status:** Manual — Documented

---

### AG-06 — Identify neighborhoods with demand but weak coverage
- **Trigger:** Coverage gap analysis
- **Frequency:** Weekly
- **Current method:** Coverage gap report + manual judgment
- **Current manual effort:** Moderate
- **Recommended system:** Coverage gap already surfaces this; feeds scout_priority
- **Human review requirement:** Yes — for expansion decisions
- **Priority:** ✅ Done (covered by coverage gap)
- **Status:** Partially Automated

---

## Operations

### OP-01 — Prioritize what to work on
- **Trigger:** Start of week; after completing a task
- **Frequency:** Weekly
- **Current method:** Manual; LABS_V2_PLAN.md §6 weekly cadence
- **Current manual effort:** Moderate
- **Recommended system:** `ops/state/current-priority.md` — updated weekly; weekly review loop surfaces top 3 priorities
- **Human review requirement:** Yes — judgment decision
- **Priority:** Medium
- **Status:** Manual — Documented (requires human judgment)

---

### OP-02 — Record product decisions
- **Trigger:** Any significant design or architecture decision
- **Frequency:** Per decision (2–5/week during active development)
- **Current method:** `DECISION_LOG.md` (ADR format) — well-established
- **Current manual effort:** Low — template exists
- **Recommended system:** Continue ADR format at `DECISION_LOG.md`; add `docs/DECISION_LOG.md` for operations decisions
- **Human review requirement:** N/A
- **Priority:** ✅ Done
- **Status:** Automated (template) + Manual (content)

---

### OP-03 — Record failed experiments
- **Trigger:** After any experiment completes (success or failure)
- **Frequency:** Per experiment
- **Current method:** DECISION_LOG.md ADRs; JOURNAL.md for informal notes
- **Current manual effort:** Low when template is followed
- **Recommended system:** `docs/DECISION_LOG.md` operations log; rule: no experiment repeated without explanation of what changed
- **Human review requirement:** N/A
- **Priority:** Medium
- **Status:** Partially Automated (template)

---

### OP-04 — Create weekly status report
- **Trigger:** End of week
- **Frequency:** Weekly
- **Current method:** SHIP_LOG.md + CHANGELOG.md; manual
- **Current manual effort:** Moderate
- **Recommended system:** `ops/reports/weekly-growth.md` template; scheduled draft from git log + agent telemetry
- **Human review requirement:** Yes
- **Priority:** Medium
- **Status:** Manual — Documented

---

### OP-05 — Document repeated debugging findings
- **Trigger:** After resolving a recurring bug
- **Frequency:** Per recurring bug
- **Current method:** Informal; JOURNAL.md
- **Current manual effort:** Low — but often not done
- **Recommended system:** Add to `ops/decisions/decision-log.md` with "recurring bug" tag; rule: bug fixed twice = documented
- **Human review requirement:** N/A
- **Priority:** High
- **Status:** Manual — Documented

---

### OP-06 — Monitor agent health
- **Trigger:** Daily / per Scout and Curator run
- **Frequency:** Daily
- **Current method:** `/admin/ops` dashboard aggregates Scout/Curator/Coverage-Gap/Optimizer/Eval status
- **Current manual effort:** Minimal — dashboard exists
- **Recommended system:** **MONITORED** — `/admin/ops` is the single pane. Add alert rule for consecutive failures.
- **Human review requirement:** Yes when alerts fire
- **Priority:** ✅ Done
- **Status:** Monitored

---

### OP-07 — Manage the second-occurrence rule
- **Trigger:** Any task performed for the second time
- **Frequency:** Continuous
- **Current method:** None — this is what the entire ops system addresses
- **Current manual effort:** High — easy to forget
- **Recommended system:** `ops/logs/automation-runs.jsonl` — append-only log of every task run with occurrence count; tasks without reusable asset flagged as AUTOMATION_REQUIRED
- **Human review requirement:** Yes — for deciding automation strategy on second occurrence
- **Priority:** High
- **Status:** ✅ **Implemented** (see `ops/` directory structure)

---

## Estimated Time Savings (Monthly)

| System | Hours Saved/Month | Confidence |
|---|---|---|
| cafelist:quality-gate | 8–12h | High |
| cafelist:check-stale | 4–6h | High |
| cafelist:find-duplicates | 3–5h | High |
| Scout automation (existing) | 10–15h | High |
| Curator automation (existing) | 8–12h | High |
| Coverage gap report (existing) | 2–3h | Medium |
| ops/ directory + templates | 3–5h | Medium |
| Weekly report template | 2–3h | Medium |
| **Total** | **40–61h/month** | — |

---

_Last updated: 2026-06-13. Update this file when any task status changes or a new recurring task is identified._
