# Cafelist × Algolia — Build Scope

_Portfolio implementation targeting the Algolia **Customer Success Engineer** role.
The goal is not "add search" — it's to produce a customer-grade implementation I can
walk a hiring manager through: architecture decisions, security, relevance tuning,
resilience, and measurement._

---

## Why this artifact maps to the CSE role

| JD line | What in this build proves it |
|---|---|
| "Scope, shape and present technical workshops to drive adoption" | Case study + Loom walkthrough of the implementation |
| "Advise customers on best practices around search implementation and optimization" | Relevance config: searchable-attribute ordering, custom ranking on `workability_score`, synonyms, facets |
| "Act as consultant delivering ad-hoc services tailored to needs" | Problem→solution framing over a real app with real data |
| "Functional knowledge of JavaScript / REST API / DB management / web dev" | Node indexing pipeline + React InstantSearch UI + Supabase source |
| "Deliver technical workshops (implementation, code review)" | The written runbook + annotated PR |
| Nice-to-have: Python, GitHub | Existing `scripts/*.ts`, public repo |

Every phase below tags the **JS skill it drills** so the build doubles as prep for the
5–10 min live coding exercise.

---

## Guardrails

- Build on a branch `feat/algolia`, gated behind `NEXT_PUBLIC_ALGOLIA_ENABLED`. `main` = prod, so nothing ships until the flag flips. Demo via Vercel **preview deploy**.
- Search-only key in the browser; **Admin key server-side only**. This key separation is itself a CSE talking point (customers get this wrong constantly).
- On any Algolia error, fall back to the existing `getSpots()` Supabase path — cafelist already has a `serviceError` fallback pattern to mirror.

---

## Architecture

```
Supabase (spots, source of truth)
   │  ① bulk load  (scripts/algolia-index.ts, Admin key)
   │  ② live sync  (DB webhook → Edge Function sync-algolia, Admin key)
   ▼
Algolia index: spots_prod
   ▲
   │  search-only key (public)
React InstantSearch  ←  new <SearchExperience/> (replaces SpotsDirectory useMemo filter)
   │
   └─ click/convert events → Algolia Insights (adoption analytics)
```

## Index record shape (`spots_prod`)

```jsonc
{
  "objectID": "<spots.id>",
  "name": "...", "slug": "...", "city": "...", "neighborhood": "...",
  "type": "coffee_shop",
  "address": "...",
  "vibe_tags": ["cozy","quiet"],
  "notes": "...",
  "has_wifi": true, "has_outlets": true, "laptop_friendly": true,
  "has_bathroom": true, "noise_level": "quiet",
  "work_score": 7.2, "workability_score": 8.2,
  "workability_band": "great",          // derived: great/good/ok — for a clean facet
  "cover_photo": "https://…/spot-photos/…/0.jpg",
  "_geoloc": { "lat": 40.74, "lng": -73.99 }   // enables geo/near-me search
}
```

**Index settings**
- `searchableAttributes`: `name`, `neighborhood`, `city`, `unordered(vibe_tags)`, `unordered(notes)`, `address`
- `attributesForFaceting`: `searchable(neighborhood)`, `city`, `type`, `has_wifi`, `has_outlets`, `laptop_friendly`, `has_bathroom`, `noise_level`, `workability_band`
- `customRanking`: `desc(workability_score)`, `desc(work_score)`
- `synonyms`: `wifi ⇄ wi-fi ⇄ wireless`, `laptop ⇄ work`, etc.

---

## Phased build

### Phase 0 — Setup (30 min)
- Create the Algolia app + `spots_prod` index (you have an account).
- Add env: `ALGOLIA_APP_ID`, `NEXT_PUBLIC_ALGOLIA_SEARCH_KEY`, `ALGOLIA_ADMIN_KEY` (server-only) to `.env.local`, Vercel, and the Edge Function secret.
- `npm i algoliasearch react-instantsearch`
- **JS drill:** env/config, module setup.

### Phase 1 — Indexing pipeline (½ day) · *the "DB management + REST API" proof*
- `scripts/algolia-index.ts` (mirrors existing script pattern): read `status='approved'` spots from Supabase → `map()` to the record shape above → `saveObjects` in batches of 1000 → `setSettings`.
- Idempotent, safe to re-run; logs counts like the other scripts.
- **JS drill:** `map`/`filter`/`reduce` transforms, `async/await`, batching, error handling.

### Phase 2 — Search UI (1 day) · *the JavaScript/React core*
- New `SearchExperience.tsx` using InstantSearch, rendered on a `/search` route (safer than swapping the homepage) behind the flag:
  - `<SearchBox>` with typo-tolerant instant results
  - `<RefinementList>` for neighborhood + `<ToggleRefinement>` for wifi/outlets/laptop-friendly
  - `<Hits>` rendering the existing `SpotCard`
  - `<CurrentRefinements>`, `<Stats>`, `<Pagination>`/`<InfiniteHits>`, `<Configure hitsPerPage={24}>`
- **JS drill:** React hooks, props, event handlers, JSX, component composition — exactly the surface a live exercise pulls from.

### Phase 3 — Relevance & optimization (½ day) · *the "advise on best practices" proof*
- Tune `searchableAttributes` order, `customRanking`, add synonyms, add a Query Rule (e.g., "quiet" boosts `noise_level:quiet`).
- Optional: replica indexes for sort-by (workability vs distance).
- Write a short "relevance rationale" note — this is your workshop content.
- **JS drill:** reasoning about data → ranking; small config code.

### Phase 4 — Live sync (½ day) · *event-driven architecture, senior signal*
- Supabase **Database Webhook** on `spots` insert/update/delete → Edge Function `sync-algolia` → `partialUpdateObject` / `deleteObject` (Admin key from secret).
- Demonstrates keeping an index consistent with the DB in real time — the #1 thing Algolia customers actually struggle with.
- **JS drill:** webhooks, request parsing, idempotent upserts.

### Phase 5 — Resilience & error handling (¼ day) · *the reliability bullet*
- Wrap the search client: on network/quota error → fallback to `getSpots()` + a non-alarming banner.
- Empty-state + "no results, try broadening" UX.
- Indexing: batch + exponential backoff; document Algolia's rate/quota limits.
- **JS drill:** promises, try/catch, retry/backoff.

### Phase 6 — Analytics (¼ day) · *"ensure customers adopt… measure outcomes"*
- Enable Search Analytics; wire InstantSearch Insights click/convert events into the existing `user_events` logging.
- Screenshot the analytics dashboard for the case study.

---

## Deliverables (what the hiring manager sees)

1. **Working demo** — Vercel preview URL of `/search`, flag-gated.
2. **The PR** — clean, well-commented, one branch. CSEs review customer code; show you write reviewable code.
3. **Case study (`ALGOLIA_CASE_STUDY.md`)** — problem, architecture, key/security decisions, relevance rationale, resilience, analytics, and a "how I'd advise a customer doing this" section.
4. **3–5 min Loom** — the "technical workshop" artifact, narrated in your consultative voice.

---

## Live-coding prep map

The exercise is ~5–10 min, collaborative, "problem-solving + communication + coding approach." Building this drills the exact JS it draws from:
- Data transforms (Phase 1) → `map`/`filter`/`reduce`, objects/arrays, JSON.
- Async (Phases 1,4,5) → promises, `async/await`, `fetch`, error handling.
- React (Phase 2) → hooks, state, rendering a list from an API response.
- Talking while coding → you narrate decisions the way Phase 3 asks you to.

> Follow Algolia's candidate AI policy: use this build to get genuinely fluent; the live coding must be your own.

---

## Effort & sequencing

- **MVP for an application (Phases 0–2):** ~1.5–2 focused days → working search + facets + a demo URL. Enough to attach to the application now.
- **Full portfolio piece (Phases 3–6 + case study + Loom):** ~1 week part-time.

Ship the MVP first, apply, then keep building the depth for the interview rounds.

---

## Decisions to confirm before building

1. **Surface:** new `/search` page (safer, recommended) vs replacing the homepage filter.
2. **Depth now:** MVP (0–2) to attach to the application, or push straight through Phase 4+.
3. **Sync mechanism:** real-time webhook→Edge Function (impressive) vs a simpler re-index script on a schedule (faster to build).
