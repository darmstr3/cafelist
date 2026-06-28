# SEO Page Template

_Use this template when creating a new neighborhood or category page. Do not publish until `cafelist:quality-gate --seo` returns READY._

---

## Pre-creation checklist

Before drafting the page:

- [ ] `npm run cafelist:quality-gate --seo --neighborhood="[NAME]"` returns READY
- [ ] ≥ 3 spots with workability_score ≥ 6 and status=approved
- [ ] All featured spots have enriched_at set
- [ ] No existing page with > 50% same spot list
- [ ] Spots verified within 180 days (or disclaimer added)

---

## Page: [Page Title]

**URL:** `/[path]`
**Target keyword:** `[keyword]`
**Meta title:** `[50–60 chars]`
**Meta description:** `[150–160 chars]`
**Canonical:** `https://cafelist.app/[path]`
**Robots:** `index, follow` (only when quality gate READY)
**Last reviewed:** `[YYYY-MM-DD]`

---

## H1

`[Specific, not clickbait. E.g.: "Quiet cafes with outlets in Fort Greene"]`

---

## Introduction (2–3 sentences max)

_Write from real knowledge of the neighborhood or omit. No AI-generated neighborhood descriptions. No invented "vibrant coffee scene" copy._

---

## Spots

_For each featured spot (minimum 3, maximum 8):_

### [Spot Name]

**Workability score:** [X]/10
**Why it works for [use case]:** [One sentence from workability_reasoning field. NOT invented.]
**Tradeoffs:** [One sentence — what to watch out for. E.g.: "Closes at 5pm on weekdays."]
**Tags:** [vibe_tags]
**Wi-Fi:** [Confirmed / Likely / Reported / Unknown] — [evidence if available]
**Outlets:** [Confirmed / Reported / Unknown] — [only claim if enriched_at set]
**Hours:** [structured hours or "hours unknown"]
**Last verified:** [last_verified_at date or "not yet manually verified"]
**[Google Maps link]**

---

## Data note (required)

_We verified [N] spots in [neighborhood] as of [date]. [Optional: honest statement about coverage gaps, e.g.: "We have [X] approved spots with workability scores in this neighborhood — this list will grow as we verify more."]_

---

## Internal links (required)

- Individual spot pages: `/spot/[slug]` for each featured spot
- Neighborhood overview: `/[neighborhood]` if it exists
- Related category: `/[related-category]` if relevant

---

## Post-creation checklist

- [ ] Quality gate passed (READY status)
- [ ] Human reviewed all claims against actual DB fields
- [ ] No invented facts
- [ ] Internal links verified (no 404s)
- [ ] `robots: index, follow` only if all featured spots verified within 180d
- [ ] Added to `ops/state/seo-state.json`
- [ ] PR reviewed before merge to main
