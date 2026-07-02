# CafeList × Algolia — Implementation Case Study

_I implemented Algolia into CafeList (a NYC "cafés worth working from" discovery
app) the way a Customer Success Engineer would deploy it for a customer:
end-to-end, right-sized, and with a documented rationale for every decision._

---

## The problem (before)

CafeList's browse was a **client-side `useMemo` filter** over the full spots table:
- No typo tolerance — "stumtown" returned nothing.
- No relevance ranking — matches came back unordered, so the *best* café wasn't first.
- Only matched name/neighborhood/city — a café whose *description* mentioned a roaster was invisible.
- It shipped the **entire dataset to the browser** and filtered in JS — invisible at 177 records, a real problem the moment the catalog grows to multiple cities.

## The goal

Turn browse into **typo-tolerant, relevance-ranked discovery** that leads with the
most workable spots — and keep the implementation right-sized for the scale, not
over-engineered to look impressive.

## Architecture

```
Supabase (spots, source of truth)
   │  atomic reindex  (replaceAllObjects, Admin key, server-side)
   ▼
Algolia index: cafelist_spots  ──►  Search Analytics + Insights (adoption/coverage)
   ▲
   │  Search-Only key (safe in browser)
InstantSearch  ──►  /search page (additive; homepage stays on Supabase)
```

## Key decisions & tradeoffs

1. **Ranking on a business signal.** `customRanking: desc(workability_score), desc(work_score)`. Textual relevance ranks first (Algolia's tie-breaking formula); the editorial workability score breaks ties — so results are relevant *and* the most workable surface first. The quality signal lives in ranking config, not the query.
2. **`replaceAllObjects`, not `saveObjects`.** Atomic, zero-downtime reindex that also drops spots no longer `approved`. `saveObjects` would leave demoted spots as stale results. Tradeoff: a temp index during the swap — negligible at this scale.
3. **Key security.** Admin (write) key is server-side only (Supabase secret). The browser only ever holds a **Search-Only** key — safe by design. Admin keys can delete indices; they never ship to a client.
4. **Render results from the index.** Cards paint from the Algolia record (name, neighborhood, cover photo, amenities) with no per-hit DB round-trip — the instant-search pattern.
5. **Synonyms + typo tolerance.** `wifi/wi-fi/wireless`, `outlets/plugs/charging` reconcile user vocabulary with the data; typo tolerance on for names/descriptions.
6. **Sync = scheduled reindex, not webhooks.** The catalog changes rarely, so a periodic atomic reindex meets the freshness need. Real-time webhook sync would add failure modes with no user payoff — I right-sized to write frequency.
7. **Additive `/search`, flag-gated.** The homepage keeps its Supabase query, so an Algolia outage can never take the site down. Search is never a single point of failure.

### Deliberately NOT built (and why)
Replicas/multi-sort, Query Rules, Personalization, Recommend, A/B testing, real-time
sync. All real Algolia features, all zero user payoff at 177 records / one city.
Building them to pad the demo would be the anti-pattern — right-sizing is the signal.

## Results

- **177 records** indexed with full relevance config, atomic reindex.
- **~1 ms** query latency.
- Typo test — searching **`stumtown`** returns *Stumptown Coffee Roasters* (typo-corrected) **and** *Black Brick Coffee* (its description mentions Stumptown — a cross-field match the old filter couldn't do).
- Clearing the query leads with the highest-workability spots, not alphabetical.

## Measurement

Algolia **Search Analytics** captures top queries, click-through, and — most useful
for CafeList — **no-result queries**, which double as a coverage signal (what people
search for that we don't have yet). That closes the loop from search back into
product decisions.

## What I'd do next (advising the customer)

1. Use no-result analytics to drive relevance tuning and catalog priorities.
2. At larger scale, evaluate **NeuralSearch** (semantic/hybrid) for natural-language queries — weighed against the plan tier and latency.
3. Grow the catalog from trusted, verified sources so search has real depth.

---

## Loom walkthrough (≈3 min) — narration beats

1. **The problem (20s):** show the old client-side filter; type "stumtown" → nothing.
2. **The fix (40s):** open `/search`; same typo → Stumptown + the cross-field match; note ~1ms.
3. **Relevance (30s):** clear the box → best-workability first; explain `customRanking` vs the query.
4. **Facets (20s):** toggle Wi-Fi / a neighborhood → live counts.
5. **The engineering (45s):** Admin vs Search key split; `replaceAllObjects` (delete-safe); render-from-index; additive page so an outage can't break the site.
6. **Measurement + next (25s):** Search Analytics / no-result queries → coverage decisions; when I'd reach for NeuralSearch.
