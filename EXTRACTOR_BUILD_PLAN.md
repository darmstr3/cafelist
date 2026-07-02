# CafeList Extractor — Build Scope

_Turn trusted human recommendations (blog posts, tweets, "best laptop cafés in
Brooklyn" listicles) into **verified**, quality-gated NYC spots — scaling coverage
on *other people's on-the-ground verification* instead of raw scraping._

**Dual purpose:** (1) the safe way to grow CafeList's catalog without personally
visiting every place; (2) an "AI document-processing / workflow-automation"
artifact for CSE / TCSM / the Lido-lane roles.

---

## Core design principle

**LLM for the fuzzy part, deterministic API for the ground truth.**
- Claude reads unstructured text and extracts *candidate* café names + the endorsement context.
- Google Places is the system of record: it confirms the place is **real**, supplies canonical data, and **kills hallucinations** — if the LLM invents or misreads a café, it simply won't resolve to a real NYC place and gets dropped.

That LLM-plus-deterministic split is the whole interview story: you used AI where ambiguity lives and a hard source where truth lives — and designed the pipeline so a model mistake can't pollute production.

---

## Pipeline (slots into the existing ingestion)

```
Source (paste text / URL / tweet)
      │  ① EXTRACT  (Claude Haiku → structured candidates)
      ▼
[{ name, area_hint, quote, claimed_amenities }]
      │  ② RESOLVE  (Google Places textSearch + details — deterministic)
      ▼  drop anything that doesn't resolve to a real NYC place
Resolved candidates (place_id, address, lat/lng, hours, rating)
      │  ③ DEDUPE   (skip google_place_id already in spots)
      │  ④ INSERT   status='pending' + provenance (source_url, quote)
      ▼
   EXISTING pipeline → Curator scores workability → ≥6 gate → (human review) → live
```

The last leg is what you already trust and just cleaned up: Curator + the `≥6`
gate. The extractor is only a **higher-quality candidate source** feeding it —
low new risk, maximum reuse (`google-places.ts`, `scout.placeToScoutRow`, the
Curator, the gate, the `/admin` review queue).

---

## What the endorsement buys you

Raw Google scraping gives you *every* café; the extractor gives you cafés a real
person already vouched for, **with the reason attached**. We keep that quote:
- It's a quality signal (a human chose to recommend it).
- `claimed_amenities` ("tons of outlets, quiet") seed `notes`/`vibe_tags`, so the Curator scores from richer signal.
- Stored as provenance ("recommended by <source>"), it's a transparency feature *and* a trust trail you can spot-check.

---

## Phases (each: product + technical justification + cost)

**Phase 1 — Extraction core** _(the AI part)_
- *Product:* paste a source, get a clean list of named cafés + why they're good.
- *Technical:* Claude Haiku, strict JSON output, schema-validated; handles "no cafés found" gracefully.
- *Cost:* one Claude call **per document**, admin-triggered — well under a cent. Not a per-user runtime cost.

**Phase 2 — Resolve & verify** _(deterministic)_
- *Product:* only real, findable NYC places make it through.
- *Technical:* `textSearch(name + area_hint + "New York")` → `getPlaceDetails`; confidence check; drop non-NYC / no-match. Reuses `google-places.ts`.
- *Cost:* a few cents of Places quota per source, one-time (billed cafelist project key).

**Phase 3 — Dedupe & stage**
- *Product:* no duplicates of spots you already have.
- *Technical:* match on `google_place_id`; insert survivors `status='pending'` with `source`, `source_url`, `source_quote` columns; map via `placeToScoutRow`.

**Phase 4 — Human review queue** _(your quality control)_
- *Product:* you eyeball extractor candidates before they go public — directly addresses "it's hard to verify everything."
- *Technical:* reuse the existing `/admin` pending→approve/reject flow; show the source quote + Maps link so a 5-second glance is enough.

**Phase 5 — Input UI** _(optional, last)_
- A simple `/admin` form: paste a URL or text → run the pipeline → see resolved candidates. Until then a script/edge-function is enough — the value is the pipeline, not the form.

---

## Cost & safety summary (the part you were worried about)

- **No per-user LLM cost.** Extraction runs only when *you* add a source — batch, admin-side, Haiku. Bounded and predictable.
- **Hallucinations can't ship:** anything the LLM invents fails Phase 2 resolution and is dropped.
- **No blind auto-publish:** the `≥6` gate + Phase 4 review keep a human/quality check in the loop.
- **Dedupe** prevents catalog bloat.

## Deliberately NOT building
- Auto-crawling the web for sources (scope creep + quality risk) — *you* supply trusted sources.
- Auto-publish without the gate/review.
- A fancy UI before the pipeline works.

---

## Decisions to confirm
1. **Input for v1:** pasted text only, or also fetch-from-URL? (Paste is simpler and safer to start.)
2. **Staging:** reuse `spots` with `status='pending'` + provenance columns (less work), or a separate `spot_candidates` table (cleaner separation)? Recommend the former.
3. **Where it runs:** a Supabase Edge Function (I can build + run headless, no laptop) vs a repo script (`scripts/extract-spots.ts`). Recommend building headless first, then mirroring to the repo as the owned artifact.
