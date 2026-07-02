# CafeList × Algolia — CSE Implementation Brief & Interview Prep

_Written as the Algolia Customer Success Engineer responsible for a production
deployment. Goal: an implementation that materially improves CafeList **and** that
you can defend, line by line, in an interview._

---

## 1. Architecture critique (what we have right now)

What exists after bootstrapping:
- An **indexer** (Supabase Edge Function) that reads `status='approved'` spots, maps them to records, `setSettings`, `saveObjects` → index `cafelist_spots`.
- Index settings: `searchableAttributes`, `attributesForFaceting`, `customRanking: desc(workability_score), desc(work_score)`, typo tolerance on.
- **Keys:** Admin key server-side (Supabase secret); Search-only key destined for the browser.
- **Sync:** manual (re-invoke the function). **Frontend:** not built yet.

Honest problems with this as a *production* setup:
1. **`saveObjects` never removes deleted records.** If a spot is demoted to `rejected`, it lingers in the index → stale results. A full-catalog job should be an **atomic reindex** that also handles deletions.
2. **The indexer lives only as an edge function.** Fine to bootstrap headless, but the maintainable, reviewable artifact belongs in the repo (`scripts/algolia-index.ts`) and/or CI. An edge function is invisible to code review.
3. **No relevance safety net for vocabulary mismatch** — "wi-fi" vs "wifi" vs "wireless" are different tokens without synonyms.
4. **Search key is unscoped.** A browser key should be restricted to *this index* and search-only; ideally rate-limited. Not a leak (it's meant to be public) but scope-limit it.
5. **No analytics wired**, so we can't see what users search for or where results are empty — which is exactly CafeList's Coverage-Gap question.
6. **No defined failure mode** for "Algolia unreachable / quota hit" on the frontend.

## 2. Recommended improvements (and the tradeoffs)

| Change | Why | Tradeoff |
|---|---|---|
| `saveObjects` → **`replaceAllObjects`** | Atomic, zero-downtime reindex that also drops deleted records | Uses a temporary index + move op (briefly ~2× records); fine at this scale |
| Add **synonyms** (wifi/wi-fi/wireless, laptop/work) | Removes vocabulary-mismatch misses | Over-broad synonyms hurt precision — keep them tight |
| **Mirror indexer into the repo** (`scripts/algolia-index.ts`) | Reviewable, version-controlled, runnable in CI | Slight duplication with the edge function (bootstrap vs owned artifact) |
| **Scope the Search key** to `cafelist_spots`, search-only | Least privilege on the public key | One-time dashboard step |
| **Frontend fallback** to `getSpots()` on Algolia error | Search outage ≠ dead site | A little extra code; mirrors existing `serviceError` pattern |
| **Enable Search Analytics + click events** | Feeds Coverage-Gap decisions; proves "measure outcomes" | Minor instrumentation |
| **Sync = re-index on the Curator/Scout cadence**, NOT webhooks | Data changes rarely; right-sized | Index can be up to one cycle stale — acceptable for a discovery catalog |

Deliberately **not** doing: real-time webhook sync, replicas/multi-sort, Query Rules, Personalization, Recommend, A/B. No user payoff at 177 records/one city; building them to pad a demo is the anti-pattern you asked me to avoid.

---

## 3. Concept-by-concept (interview prep)

Each: **why the user cares · why a customer implements it · concepts it shows · likely interview question · best answer.**

### Indexing
- **User:** results exist and are fresh.
- **Customer:** Algolia searches its *own* copy of your data (an index of flat JSON records), not your DB — that's how it returns in ~1ms.
- **Concepts:** records/objectID, `saveObjects` vs `replaceAllObjects`, batching, settings vs records.
- **Interview Q:** "How do you keep the index in sync with the source of truth?"
- **Best answer:** "Depends on write frequency. High-write catalogs (inventory, pricing) → incremental `partialUpdateObject`/`deleteObject` driven by DB events or a queue. Low-write, like a curated cafe catalog → a periodic atomic `replaceAllObjects` job on the cadence the data changes. I choose the simplest mechanism that meets the freshness SLA; I don't reach for real-time sync unless writes justify it."

### Relevance & ranking
- **User:** the *best* spot is first, not just *a* match.
- **Customer:** default relevance sorts by textual match (the tie-breaking ranking formula), then your `customRanking` business signals.
- **Concepts:** Algolia's ranking formula (typo → geo → words → filters → proximity → attribute → exact → custom), `customRanking`, tie-breaking.
- **Interview Q:** "How is Algolia ranking different from a SQL `ORDER BY`?"
- **Best answer:** "SQL sorts on columns. Algolia first ranks by *textual relevance* through a tie-breaking formula, then applies `customRanking` (business signals like popularity — here, `workability_score`) only to break ties. So you get the most relevant match, and among equally-relevant matches, the most workable one surfaces. I put editorial/quality signals in `customRanking`, not in the query."

### Search configuration & facets
- **User:** filter by what matters (neighborhood, wifi, outlets) and see counts.
- **Customer:** `attributesForFaceting` declares which fields are filterable/refinable; `searchableAttributes` (ordered) declares what's searched and how strongly.
- **Concepts:** `searchableAttributes` ordering (earlier = higher weight), `unordered()`, `filterOnly()` vs `searchable()` facets, facet counts.
- **Interview Q:** "A customer says a field isn't filterable — what do you check?"
- **Best answer:** "Whether it's in `attributesForFaceting`. Filtering/faceting only works on declared facet attributes; searching only works on `searchableAttributes`. I'd also check `filterOnly()` (filter but not shown as a facet) vs `searchable()` facet (users can search within facet values), and confirm the attribute exists on the records."

### Typo tolerance
- **User:** "stumtown" still finds Stumptown.
- **Customer:** on by default; distance-based (1 typo ≥4 chars, 2 typos ≥8 by default), configurable per attribute.
- **Concepts:** `typoTolerance`, `minWordSizefor1Typo/2Typos`, `disableTypoToleranceOnAttributes` (e.g., SKUs).
- **Interview Q:** "When would you turn typo tolerance *off*?"
- **Best answer:** "On exact-identifier fields — SKUs, part numbers, codes — where a 'correction' returns the wrong product. I'd disable it on those attributes while leaving it on for names/descriptions. It's per-attribute, not all-or-nothing."

### Synonyms
- **User:** "wireless" finds the "wifi" spots.
- **Customer:** reconcile vocabulary the data doesn't share with how users phrase things.
- **Concepts:** two-way vs one-way synonyms, `saveSynonyms`, over-broad synonyms hurting precision.
- **Interview Q:** "Synonyms vs Query Rules — when each?"
- **Best answer:** "Synonyms = pure vocabulary equivalence (couch⇄sofa). Query Rules = behavior on a trigger (query 'sale' pins a banner, boosts a category, filters). If it's 'these words mean the same thing,' synonyms. If it's 'when the user does X, change the results/UI,' a rule."

### Security — Admin vs Search API keys
- **User:** (invisible) their data isn't writable from the browser.
- **Customer:** **Admin key = full write, server-side only, never shipped.** **Search-only key = read, safe in the browser.** Optionally **secured API keys** generated at runtime to scope a search key with filters (multi-tenant: `owner:userID`).
- **Concepts:** key scoping (per-index, per-operation), secured API keys, key rotation.
- **Interview Q:** "A customer has their Admin key in frontend JS. What do you do?"
- **Best answer:** "Treat it as compromised: rotate it immediately, move all indexing server-side, and switch the frontend to a search-only key scoped to just that index. If they need per-user restrictions, use secured API keys generated server-side with filters. Admin keys can delete indices — they never belong in a browser."

### Sync strategy
- **Interview Q:** "Walk me through choosing a sync approach."
- **Best answer:** "Start from write frequency and freshness SLA. Rare writes / minutes-of-staleness OK → scheduled atomic `replaceAllObjects`. Frequent writes / near-real-time needed → incremental updates from DB triggers, webhooks, or a CDC/queue pipeline, with `partialUpdateObject` for changes and `deleteObject` for removals. I right-size it — real-time sync adds moving parts and failure modes, so I only build it when the freshness requirement demands it." (For CafeList: scheduled reindex — correct call.)

### Analytics
- **User:** (indirect) the catalog grows toward what they actually search for.
- **Customer:** Search Analytics (top queries, no-result queries, CTR) + Insights click/conversion events to close the relevance loop and prove ROI.
- **Concepts:** Analytics vs Insights (events), no-results-rate as a coverage signal, click-through as a relevance signal.
- **Interview Q:** "How do you measure if search is 'good'?"
- **Best answer:** "No-results rate (are we failing queries?), click-through and click position (are top results the right ones?), and conversion if there's a downstream action. I'd watch no-results queries especially — they're both a relevance problem and, for CafeList, a coverage signal telling us which neighborhoods to add next."

### Failure modes
- **Interview Q:** "Algolia returns an error or times out mid-session — what happens to the user?"
- **Best answer:** "Never a blank page. The client should catch errors and degrade gracefully — for CafeList, fall back to the existing Supabase query so browse still works, with a quiet 'search temporarily limited' note. On the indexing side: batch, handle rate limits with backoff, and use atomic reindex so a failed run never leaves a half-updated index. Design for the dependency being unavailable."

---

## 4. Build order (real deployment, not demo)
1. Harden the indexer: `replaceAllObjects` + synonyms + mirror to `scripts/algolia-index.ts`. _(doing now, headless)_
2. `/search` UI: InstantSearch (SearchBox, neighborhood + amenity refinements, SpotCard hits, Stats, Pagination), flag-gated, with a Supabase fallback.
3. Wire click analytics (Insights) — small, closes the loop.
4. Scope the Search key + document sync cadence.
