# CafeList SEO Rules

Rules for programmatic SEO pages. Every rule here exists because the alternative produces content that hurts users and the product.

---

## The fundamental rule

**A public SEO page must be useful to someone making an actual decision.** If a person lands on the page and can't use the information to choose a specific cafe, the page should not exist publicly.

---

## Quality gate (all conditions must be met to publish)

1. **Minimum 3 spots** that genuinely match the page's claimed attributes with `workability_score ≥ 6` and `status = 'approved'`.

2. **No fabricated attributes.** If the page claims "outlets confirmed," every featured spot must have `has_outlets=true` AND `enriched_at IS NOT NULL` with `enrichment_signals.outlets.confidence ≥ 0.6`. If `enriched_at` is null, the outlet claim cannot be made.

3. **Hours must be structured.** If the page claims "open after 5pm," every featured spot must have structured `hours` data (not null) showing close time ≥ 21:00. A `vibe_tag` of "late hours" without structured hours is insufficient.

4. **Freshness.** Featured spots must have `last_verified_at` within 180 days OR a recent `enriched_at` within 90 days. Older data requires a "last reviewed: [date]" disclaimer and the page should be `noindex` until refreshed.

5. **Not duplicative.** Don't create `/best-cafes-for-remote-work-in-fort-greene` and `/laptop-friendly-cafes-fort-greene` as separate pages with the same 3 spots. Consolidate.

---

## Page statuses

- **READY** — passes all quality gate conditions. Can be created and indexed.
- **ON HOLD** — close to passing. Specific enrichment or verification steps would unblock it. List what's needed.
- **BLOCKED** — fundamental data gap. Even with enrichment, the page can't be supported by the current data. Do not create.

---

## Good page targets

Pages that have a specific workability angle backed by structured data:

```
/best-cafes-to-work-from-in-[neighborhood]
/quiet-cafes-with-outlets-in-[neighborhood]
/laptop-friendly-cafes-open-late-in-[neighborhood]
/best-coffee-shops-for-remote-work-near-[landmark/area]
/cafes-good-for-client-meetings-in-[neighborhood]
/[neighborhood]-cafes-open-after-9pm
```

---

## Bad page targets

Do not create these:

- Generic "best coffee shops in [neighborhood]" — no workability angle, competes with Yelp/Google
- "Ultimate guide to working from cafes in NYC" — thin, AI-slop-adjacent
- Pages for neighborhoods with < 3 qualifying spots — honest "we don't have coverage yet" is better
- Pages targeting keywords we have no data advantage on (e.g., "best pour-over in NYC")
- Neighborhood landing pages that exist only to link to other pages with no original data

---

## Required page elements

Every published SEO page must include:

1. **H1** — specific, not clickbait. "Quiet cafes with outlets in Fort Greene" not "The Best Fort Greene Cafes You Need to Know"
2. **Last reviewed date** — visible to users
3. **Confidence labels on key claims** — "Wi-Fi confirmed" vs "Wi-Fi reported"
4. **Tradeoffs for each spot** — "closes at 5pm" or "no confirmed outlets" when relevant
5. **workability_score displayed** — always. Users deserve to see the signal.
6. **"Why this fits" reasoning** — one sentence per spot, from `workability_reasoning` or the LLM explanation layer. Not invented.
7. **Data freshness note** — when data was last verified
8. **Internal links** — to the individual spot page (`/spot/[slug]`) and neighborhood coverage page if it exists

---

## Metadata rules

- `meta title`: 50–60 chars. Lead with the specific use case, not the brand.
- `meta description`: 150–160 chars. Specific, factual, includes the neighborhood and the workability angle.
- `robots`: `index, follow` only if quality gate is fully met. Otherwise `noindex, follow`.
- `canonical`: Always set. Prevent near-duplicate indexing.

---

## Copy rules

- No invented quotes from "coffee lovers" or "remote workers"
- No invented neighborhood descriptions ("Fort Greene's vibrant coffee scene...")
- No AI-written filler paragraphs that say nothing
- Data is the content. The spots and their attributes are what make the page worth reading.
- Allowed: editor notes about the neighborhood drawn from verified experience or sourced text
- Required: honesty about limitations ("We only have 4 approved spots in Fort Greene with workability scores — this list will grow as we verify more.")
