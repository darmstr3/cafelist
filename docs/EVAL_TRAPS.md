# Trap Detection — design doc

A "Google Maps trap" is a venue that looks workable on paper (Google says it's
a coffee shop, reviews mention wifi, has ≥3.5 stars) but in real life fails the
Cafelist promise: **a place a remote worker can sit with a laptop for 2+ hours
without feeling pressured to leave.**

The current Scout + Curator pipeline narrows decently but lets specific failure
modes through. This document catalogues those failure modes, what signal we
can use to catch each from the data Scout already collects, and where a
trap-detection layer plugs into the existing flow.

This is a design — no code is wired up yet. The data module
(`src/lib/labs/trap-detectors.ts`) is the structured form of the taxonomy
below; integrating it into Scout/Curator is a follow-up PR.

---

## 1. Problem statement

### Why Google Maps falls into these traps

Google Places categorises businesses for *navigation and discovery*, not for
the "can I camp here" question. Its `types[]` array on a Place object lumps:

- Veselka (Ukrainian diner with espresso) → `restaurant, cafe`
- Fellini Coffee (stand-up Italian bar) → `cafe, coffee_shop`
- Hotel lobby bars with espresso machines → `cafe, lodging`
- Bookstore cafés with 6 stools → `cafe, book_store`
- Drive-thru-only Starbucks → `cafe, coffee_shop`

…all under labels that pass our `mapPlaceType()` filter and arrive in `spots`
as `type='coffee_shop'`. The structured boolean signals
(`has_wifi`, `has_outlets`) are derived from review text keyword matches — a
single review saying "the wifi was fine" trips `has_wifi=true` regardless of
whether the venue welcomes laptops at all.

The Curator catches some of this (bars dropped from 6.03 → 1.67 average), but
its Haiku prompt is generic. It doesn't know that *this specific spot* is a
diner that happens to be tagged `cafe`, or that *this specific spot* is a
16-square-foot stand-up bar. Trap detection is the structural layer that
encodes the patterns Donovan keeps catching by hand.

### Why a separate layer (and not just smarter Curator prompts)

Three reasons:

1. **Auditability.** Each trap is a named rule with a clear signal and a
   clear action. When a future user reports "you sent me to a diner," we can
   point at the trap rule that should have caught it and either tighten or
   add to it. A free-form prompt makes that diffing impossible.
2. **Deterministic.** Most trap signals are pure heuristics (regex match
   "Diner" in name, Google `types` contains `bar`). No LLM call needed,
   no per-row cost.
3. **Action variety.** Some traps should be REJECTED at Scout insert time
   (don't pollute the DB with a permanently-closed listing). Some should be
   FLAGGED (insert with a 2-point downgrade — workability 8.0 → 6.0).
   Some should be PROMPT_HUMAN (insert as `status='pending'` for the human
   curator queue, not auto-approve). The Curator's prompt can't model that
   action vocabulary cleanly.

---

## 2. Taxonomy

Categories (matching the `category` field in `trap-detectors.ts`):

- `food_first` — the venue's primary identity is food, not coffee
- `too_small` — physically too small or culturally not-for-camping
- `gated` — requires membership / hotel guest status / etc.
- `hostile_seating` — explicit anti-laptop policy or stand-up culture
- `data_quality` — Google listing is wrong or stale
- `other` — chains with wildly variable workability, photogenic-only spots,
  etc.

### 2.1 Diners and restaurants presenting as cafés (`food_first`)

**What it is.** A restaurant or diner that serves coffee. Veselka. Tom's
Restaurant. Most NYC bagel shops with espresso. Cuban diners. Tea houses with
food menus.

**Why it fails.** The social contract is "order food, eat, leave." Staff
expect table turn. Sitting 2hrs with a laptop reads as rude/cheap. The wifi
exists but for customers between courses, not all afternoon.

**How Google gets it wrong.** Places API returns `types: ['restaurant',
'cafe', 'food']` for many of these. Our `mapPlaceType()` correctly catches
`restaurant && !cafe` → `diner`, but venues like Veselka that include `cafe`
in their type array sneak through as `coffee_shop`.

**Examples.** Veselka, Tom's Restaurant, Russ & Daughters Café,
B&H Dairy, La Bonbonniere.

**Signal.** Name regex (`/\b(diner|deli|bistro|trattoria|brasserie|kitchen|grill|restaurant)\b/i`)
combined with `types` containing `restaurant` or `meal_takeaway`.
Review-text mentions of "brunch," "menu," "entrée," "dinner," "waiter" with
density > 2 mentions.

**Confidence.** High when the name contains the trigger word. Medium when
based on review keywords alone (a coffee shop with one mention of "brunch"
isn't necessarily a brunch spot).

**Action.** FLAG with workabilityDelta −3.0. Don't outright reject —
some hybrids (e.g. all-day cafés) are actually workable. Let the score reflect
the trap.

### 2.2 Cafés too small to work in (`too_small`)

**What it is.** Stand-up espresso bars, walk-up windows, micro-cafés.

**Why it fails.** No room to sit. No room for a laptop. The whole physical
design is "espresso in 4 minutes and leave." Brand cultures (Italian espresso
bars: Fellini, Ralph's, Eataly's coffee counter) actively dislike laptops.

**How Google gets it wrong.** Places API has no "square footage" field. Photos
exist but aren't parsed. The structured `has_wifi` flag fires anyway because
*someone in a 5-star review mentioned wifi*.

**Examples.** Fellini Coffee (West Village), Fellini Cucina, Ralph's Coffee
(Madison Ave kiosks), Eataly espresso counter, any "Caffè" with no English
seating language.

**Signal.**
- Name regex `/\b(espresso bar|caffè|caffe|kiosk|stand|window|to-go)\b/i`
- `types` includes only `cafe` plus no `restaurant` — combined with
  `userRatingCount < 200` and `priceLevel === 'PRICE_LEVEL_INEXPENSIVE'` or no
  price level
- Review keywords: "standing room only," "tiny," "no seats," "stand up," "no
  seating," "grab and go," "walk-up window"

**Confidence.** Medium. The name pattern catches Italian-branded espresso
bars cleanly (high confidence). The "tiny" review-keyword path is noisier
because "tiny but cozy" is positive in some review styles. The honest reality
is **we cannot reliably tell physical size from Google Places data alone.**
This is a category where Donovan-as-curator or user feedback ("I went, no
seats") is the only ground truth.

**Action.** FLAG with workabilityDelta −2.5 when name pattern hits.
PROMPT_HUMAN when only review-keywords hit — the false-positive rate is too
high to auto-downgrade.

### 2.3 Drive-thru-only / takeout counters (`hostile_seating`)

**What it is.** No seating, full stop. Drive-thru Starbucks. Dunkin' counter
locations. Coffee kiosks in office lobbies.

**Why it fails.** Nothing to sit on. Game over.

**How Google gets it wrong.** Lists them as `cafe`. Some include
`drive_through` in `types` but not all.

**Examples.** Drive-thru Starbucks on the LIE service road, any airport
coffee counter, Dunkin' kiosks at Penn Station.

**Signal.**
- `types` includes `drive_through` or `meal_takeaway` without `restaurant`
- Name contains "drive thru" or address contains "kiosk"
- Review keywords: "drive thru only," "no seating," "takeout only," "grab
  and go" (high density)

**Confidence.** High when `types` includes `drive_through`. Medium otherwise.

**Action.** REJECT when `drive_through` is in `types`. FLAG with delta −4.0
on review-keyword path.

### 2.4 Cafés inside non-café venues (`gated` / `hostile_seating`)

**What it is.** Coffee bars inside grocery stores (Whole Foods), bookstores
(McNally Jackson), gyms (Equinox), department stores (Bergdorf's), museums
(MoMA cafe). Seating exists but is shared with a non-café-friendly purpose.

**Why it fails.** You don't camp at a Whole Foods café — you're in someone's
weekly grocery aisle. Bookstore cafés are better but often have explicit "no
laptops past 6pm" rules. Museum cafés expect 30-minute lunch turn.

**How Google gets it wrong.** Lists the inner café as its own Place. Has all
the right flags. Reviews praise the coffee. No signal that this is a
2-stool counter inside a Whole Foods.

**Examples.** Whole Foods coffee bars, McNally Jackson Café (Nolita),
Equinox cafés, Bergdorf Goodman's café, Strand bookstore coffee.

**Signal.**
- Name contains a known host-venue brand: `/whole foods|equinox|barnes|nordstrom|bergdorf|bloomingdale|target|mcnally jackson|strand/i`
- Address contains the host-venue suffix ("inside Whole Foods", "@ Bergdorf")
- `types` includes `grocery_store`, `book_store`, `department_store`, `gym`,
  `museum`, or `tourist_attraction`

**Confidence.** High when name or `types` match the host brand. Won't catch
no-name food-court cafés.

**Action.** PROMPT_HUMAN. Some bookstore cafés (e.g. Housing Works) are
genuinely workable; others aren't. Human pass needed.

### 2.5 Hotel lobby bars masquerading as workable lobbies (`hostile_seating`)

**What it is.** Hotel lobbies range from the Ace (legitimately workable,
big communal tables, laptops welcome) to the Bowery (cocktail-bar lobby with
DJ at 6pm). Google calls them both `cafe, lodging`.

**Why it fails.** Lobby bars have stiff seating, drink-minimum culture, and
get loud at 5pm. A cocktail lounge is not a workspace.

**How Google gets it wrong.** Both Ace Hotel and Bowery Hotel return as
`hotel_lobby` after our type mapping. Our Curator does well here in
aggregate (`hotel_lobby` averaged 3.88) but specific lobbies that *are*
workable get dragged down with the bad ones.

**Examples.** The Bowery, Public Hotel, Equinox Hotel lobby. (Contrast:
Ace Hotel, Freehand, Hoxton — these are workable.)

**Signal.**
- `types` includes `bar` or `night_club`
- Name includes `/lounge|bar/i`
- Review keywords: "cocktail," "DJ," "happy hour," "no laptops"
- Hours: opens after 4pm (a lobby bar, not a daytime workspace)

**Confidence.** High via opens-after-4pm rule. Medium on review keywords.

**Action.** FLAG with delta −2.0. Don't reject — workable hotel lobbies exist,
and the Curator already does decent triage here.

### 2.6 Brewery / wine bar / cocktail-lounge hybrids (`food_first`)

**What it is.** Places that serve coffee in the morning and pivot to alcohol
at 4pm. "All-day" concepts. Brooklyn-style hybrid spots.

**Why it fails.** Morning-only workability. At 3pm the staff is resetting
for service, by 5pm the music is up, by 7pm you're in a wine bar.

**Examples.** Numerous "all-day cafés" in Williamsburg / East Village.
The Four Horsemen used to be one. Many Lower East Side spots.

**Signal.**
- `types` includes `bar`, `liquor_store`, or `night_club`
- Hours pattern: closes ≥ 22:00 (late close = bar pivot)
- Name regex `/\b(bar|wine|brewery|tap|spirits|cocktail)\b/i`

**Confidence.** High when name explicitly includes a bar-suffix. Medium on
hours-only.

**Action.** FLAG with delta −2.0 (workable in the morning, drop the score
to reflect that you wouldn't pick this for an all-day session).

### 2.7 Chain locations with variable workability (`other`)

**What it is.** Starbucks. Blue Bottle. Joe Coffee. Two locations of the
same chain can be wildly different: one has 20 seats and outlets, the next
is a 3-stool kiosk.

**Why it fails.** A 6.5 workability score on "Starbucks #4127" tells you
nothing about whether you can sit there.

**How Google gets it wrong.** Each location is a separate Place ID, but
chain branding leaks into reviews. Reviews bleed across locations in
spirit.

**Examples.** Starbucks (most variable), Blue Bottle, La Colombe, Gregorys,
Bluestone Lane.

**Signal.**
- Name matches a curated chain regex
- `userRatingCount > 500` AND the review-text signal density is low (lots of
  short reviews about the chain in general, not this branch)

**Confidence.** Low. We can identify chain membership cheaply. We CANNOT
reliably identify which specific branch is workable from Google alone.

**Action.** PROMPT_HUMAN. Chain locations should be human-curated, not
auto-scored. (Alternative: have Curator weight `has_outlets` and
`seating_comfort` more heavily for chains, accepting more 4-6 band noise.)

### 2.8 Photogenic Instagram cafés with hostile seating (`hostile_seating`)

**What it is.** The pastel-walls Instagram cafés in NoLita / Brooklyn.
Beautiful, designed for photos, with stools or curated benches that are
explicitly anti-camping.

**Why it fails.** Stools are hostile to laptop use. The vibe rewards a 15-min
photo-and-coffee visit, not 2 hours. Many post "30 minutes maximum during
weekends" signage.

**Examples.** Maman (in part), Devoción, Bibble & Sip, certain Brooklyn
specialty roasters.

**Signal.**
- `userRatingCount > 1000` with rating ≥ 4.5 (heavy social-media presence)
- Review keywords: "Instagram," "aesthetic," "for the gram," "photo,"
  "beautiful," "stunning"
- Vibe tags include "trendy" or "instagrammable" once we collect them
- (REQUIRES DATA EXPANSION: photo-count proxy — Google returns up to N
  photos, very photogenic spots have 4 maxed photos in `place.photos[]`)

**Confidence.** Low-to-medium. Pretty does not imply hostile, but the
combination of "Instagram" review mentions + high rating with low actual-work
mentions is a soft signal.

**Action.** FLAG with delta −1.5. Soft penalty, not a rejection.

### 2.9 Cafés with explicit time/laptop limits (`hostile_seating`)

**What it is.** Cafés that post "no laptops weekends," "30 minute table
limit," "laptops only before 11am," "no laptops past noon."

**Why it fails.** Self-evident.

**Examples.** Many specialty roasters in West Village (Joe Coffee Waverly
historically), Devoción weekends, certain Stumptown locations.

**Signal.** Review keywords (high confidence when present): "no laptops,"
"laptop policy," "table limit," "30 minute," "1 hour limit," "laptops only
until," "weekend no laptops," "laptops not allowed."

**Confidence.** High when keyword hits — these phrases are unambiguous.

**Action.** FLAG with delta −4.0. This is one of the highest-confidence
non-rejection traps because the keyword phrasing leaves no ambiguity.

### 2.10 Cafés inside coworking spaces (`gated`)

**What it is.** Cafés that exist inside a coworking space (WeWork, Industrious,
The Wing, Soho House). Google sometimes lists them publicly.

**Why it fails.** Members-only. You can't actually walk in.

**Examples.** Industrious café spots, WeWork espresso bars when they
were Place-listed, Soho House coffee bars.

**Signal.**
- Name contains `/wework|industrious|the wing|soho house|neuehouse|spring place/i`
- `types` includes `coworking_space` (rare but exists)
- Review keywords: "members only," "you need to be a member," "private"

**Confidence.** High on chain-name match. Medium on review keywords.

**Action.** REJECT. There's no version of "workable" that lets a stranger walk
in here.

### 2.11 Tourist-area cafés with stand-up culture (`too_small` / `food_first`)

**What it is.** Tourist-dense neighborhoods where coffee is fast-turn:
Italian-style espresso bars in Little Italy, anywhere on 5th Ave below 14th,
much of SoHo/NoLita's busier blocks.

**Why it fails.** High turn pressure even if seating exists. Tourists expect
to stand, drink, photograph, leave. Staff manage the door, not the dwell time.

**Examples.** Caffè Reggio in busy hours, Ferrara (Little Italy), tourist-zone
Starbucks, anything on Mulberry St south of Houston.

**Signal.**
- Address in known tourist zones (Times Square, Little Italy, parts of SoHo)
- High `userRatingCount` relative to neighborhood average
- Review keyword: "tourists," "touristy," "tourist trap"

**Confidence.** Low. Tourist zone is a soft signal — Caffè Reggio is workable
late evenings even though it's in a tourist zone.

**Action.** FLAG with delta −1.0. Soft.

### 2.12 Permanently closed listings (`data_quality`)

**What it is.** Google still lists a café that closed during COVID, or after
2023's small-business attrition. Sometimes for years.

**Why it fails.** Doesn't exist.

**How Google gets it wrong.** `businessStatus` is sometimes lagged. Reviews
mention "closed" / "permanently closed" / "out of business" but the structured
flag isn't updated.

**Examples.** Many West Village casualties of 2020–2022 still surface.

**Signal.**
- `businessStatus === 'CLOSED_PERMANENTLY'` (Scout already filters these in
  `textSearch`, but Place Details should be re-checked)
- `businessStatus === 'CLOSED_TEMPORARILY'`
- Review keyword density: "closed permanently," "out of business," "they
  closed," "no longer open"
- Most recent review > 6 months old AND average rating dropped 0.5+ in the
  last year (REQUIRES DATA EXPANSION — we'd need per-review timestamps)

**Confidence.** High on `businessStatus`. Medium on review keywords.

**Action.** REJECT on `businessStatus`. PROMPT_HUMAN on review-keyword
density.

### 2.13 Duplicate Google listings (`data_quality`)

**What it is.** Same business, two Place IDs. Often because the business
moved or rebranded.

**Why it fails.** We'd insert two rows for the same spot.

**How Google gets it wrong.** Place IDs are unique to Google, not to
businesses.

**Signal.** (Operates at the post-insert layer, not on a single Place.)
- Two `spots` rows with same `(lat, lng)` rounded to 4 decimals
- Two rows with same name within 200m
- Two rows with same `formattedAddress`

**Confidence.** High.

**Action.** PROMPT_HUMAN. Don't auto-merge — let a human pick which row to
keep.

### 2.14 Photo studios / film-set cafés (`other`)

**What it is.** Rare but real in NYC: cafés that double as film locations or
photography sets and are often closed to public mid-day. Some claim to be
"cafés" but only on certain days.

**Examples.** Has happened with a handful of LES storefronts.

**Signal.** Very weak from Google. Limited hours pattern (open 3 days/week),
review keywords "filming," "they were filming," "closed today for shoot."

**Confidence.** Low. Hard to detect without human knowledge.

**Action.** PROMPT_HUMAN. Just be honest that this trap can't be auto-caught.

### 2.15 Pop-up / temporary cafés (`data_quality`)

**What it is.** A café that's open for a season or for a marketing activation.

**Examples.** Brand-pop-up coffee bars (Glossier-era), seasonal Chelsea Market
stalls.

**Signal.**
- `userRatingCount < 30` AND age of listing < 6 months (REQUIRES DATA
  EXPANSION — we don't track listing-creation time)
- Name contains "pop-up," "pop up," "popup"

**Confidence.** Low.

**Action.** PROMPT_HUMAN.

---

## 3. Signal palette — what Scout already collects

From `placeToScoutRow()` in `src/lib/scout.ts` and the GPPlace shape in
`src/lib/google-places.ts`, the data available to a trap detector at Scout
time is:

| Source | Field | Notes |
| --- | --- | --- |
| Google `displayName.text` | `name` | Regex-able |
| Google `formattedAddress` | `address` | Regex-able |
| Google `types[]` | (not stored, used by `mapPlaceType()`) | Raw array — `cafe`, `restaurant`, `bar`, `lodging`, `drive_through`, etc. **Currently dropped after type mapping.** |
| Google `priceLevel` | (not stored) | `PRICE_LEVEL_INEXPENSIVE`/`MODERATE`/`EXPENSIVE`/`VERY_EXPENSIVE`. Used in `seatingComfortFromData`. |
| Google `businessStatus` | (filtered out in `textSearch`) | `OPERATIONAL` / `CLOSED_*`. Should be re-checked on details. |
| Google `rating` | (not stored directly) | 1–5 |
| Google `userRatingCount` | (not stored directly) | Useful for "is this a heavily-rated chain" |
| Google `reviews[].text.text` | review text (joined → keyword search) | Currently used for boolean flag derivation in `placeToScoutRow` |
| Google `editorialSummary.text` | `notes` (first preference) | One-sentence Google-curated description, sometimes useful |
| Google `regularOpeningHours` | `hours` | Late-close detection, "opens at 4pm" detection |
| Google `photos[]` | `photos` (first 4) | Photo *count* could be a soft signal; photo *content* requires vision (out of scope) |
| Derived | `type` | After `mapPlaceType()` |
| Derived | `has_wifi`, `has_outlets`, `laptop_friendly` | Boolean flags from review keyword presence |
| Derived | `vibe_tags` | Set of up to 6 tags from review text + type + hours |
| Derived | `noise_level`, `seating_comfort` | Coarse buckets from review text |
| Curator | `workability_score` | The number we want to defend |

**Data Scout collects but doesn't store** (would need to be expanded to
support all detectors):

- Raw `types[]` array (currently collapsed to one type)
- `priceLevel`
- `userRatingCount` and `rating`
- `editorialSummary.text` as a separate field (currently subsumed into `notes`)
- `businessStatus` (currently filtered at search-time, not re-checked at
  detail time)

Most of these are one-line additions to `placeToScoutRow` and one column each
on `spots`. The doc flags this as "requires data expansion" where relevant.

---

## 4. Action vocabulary

Three actions, mirroring the field on `TrapDetector.action`:

- **`reject`** — Don't insert into `spots` at all. Used for permanently
  closed listings, gated-coworking listings, drive-thru-only.
- **`flag_downgrade`** — Insert as usual, but apply `workabilityDelta` to the
  Curator's score (or seed the prompt with a "this venue is suspected to be
  X" hint and let Curator decide; both options are viable, see §5).
- **`prompt_human`** — Insert as `status='pending'` (not auto-approved) and
  attach a `trap_notes` field so the human curator sees the suspicion and can
  confirm/reject.

The `workabilityDelta` is **subtracted** from the Curator's eventual score.
Clamping at 0 happens at the integration site, not in the detector data.

---

## 5. Integration plan

The detector module sits between Scout (Google fetch) and Curator (LLM scoring),
plus has a post-Curator pass for `flag_downgrade`. Three integration points:

### 5.1 Scout-time hook (REJECT and PROMPT_HUMAN actions)

**File:** `src/lib/scout.ts`, inside `placeToScoutRow()` or as a wrapper
called just before the `rowsToInsert.push(row)` step in `runScout()`.

**Change size:** ~30 lines. Add a `runTrapDetectors(place, row)` that returns
`{ action: 'reject' | 'flag' | 'prompt' | 'allow', firedRules: string[], totalDelta: number }`.

```ts
// pseudo-code
const trap = runTrapDetectors(details, row)
if (trap.action === 'reject') {
  log(`     [${i}] ${name} → REJECTED by traps: ${trap.firedRules.join(', ')}`)
  continue
}
if (trap.action === 'prompt') {
  row.status = 'pending'
  row.notes = (row.notes ?? '') + `\n\n[Trap suspicion: ${trap.firedRules.join(', ')}]`
}
// flag is recorded for the Curator step below
rowsToInsert.push({ ...row, _trapDelta: trap.totalDelta })
```

**Data dependency:** Needs the raw Google `types[]` array, `priceLevel`,
`businessStatus`, and `userRatingCount` passed in. Scout currently drops
`types[]` after `mapPlaceType()` — a one-line change to keep the raw array
on the detector input is required.

### 5.2 Curator-time hook (`flag_downgrade` action)

**File:** `scripts/curate-workability.ts`.

**Change size:** ~15 lines. After Curator returns `{ score, reasoning }`,
look up the spot's `trap_delta` (persisted by Scout) and apply:

```ts
const adjustedScore = Math.max(0, score - (spot.trap_delta ?? 0))
const adjustedReasoning =
  trap_delta > 0
    ? `${reasoning} [trap penalty ${trap_delta}: ${trap_rules}]`
    : reasoning
```

**Alternative design:** Pass the fired-rule list into the Curator's prompt
as a "Suspected concerns" section and let the LLM weigh them. More flexible,
but loses determinism and costs the same per call. Recommend the
deterministic subtract path for v1.

**Data dependency:** Two new columns on `spots`:
`trap_rules TEXT[]`, `trap_delta NUMERIC(3,1)`. Both nullable.

### 5.3 Retriever-time filter (defense in depth)

**File:** `src/lib/labs/retriever.ts`.

**Change size:** ~5 lines, optional. After the workability filter, add a
final filter: `WHERE NOT ('explicit_no_laptop' = ANY(trap_rules))` so even
if a spot survived the workability cutoff somehow, an explicit no-laptop
signal kicks it out. Belt-and-suspenders.

### 5.4 Admin surface (PROMPT_HUMAN action)

**File:** `src/app/admin/page.tsx` (existing admin gate).

**Change size:** A column in the existing pending-spots view showing the
fired trap rules. No new page needed — the existing `status='pending'`
queue already exists.

---

## 6. Test approach

**Fixture file:** `src/lib/labs/__fixtures__/trap-fixtures.json` (new). A list
of ~30 hand-curated spot rows annotated with `expectedAction` and
`expectedRules`. Mix of:

- Real positive examples (Veselka, Fellini Coffee, drive-thru Starbucks,
  Whole Foods coffee bar) → expect trap to fire
- Real negative examples (Ace Hotel, Devoción flagship, Housing Works) →
  expect no trap to fire
- Edge cases (Russ & Daughters Café, McNally Jackson, Maman) → expect
  specific actions

**Test file:** `src/lib/labs/__tests__/trap-detectors.test.ts` (new). For
each fixture, run the detectors and assert:

1. `action` matches expected
2. `firedRules` is a superset of `expectedRules` (extra fires are inspected
   but not auto-failing — useful for catching over-broad regex)
3. For `flag_downgrade`, `totalDelta` is within ±0.5 of expected

**Eval harness wiring:** The existing `npm run eval` infra has a pattern for
this in `eval-checks.ts`. The trap fixture lives in the same spirit — pure
predicates that run before any LLM call. Pin each detector with at least
one positive and one negative case.

**Before shipping:** Run on the full current `spots` dataset (Donovan's NYC
~148 approved rows). Eyeball the list of rows that the detectors flag — if
the trap layer flags more than 20% of approved rows, the regexes are too
broad and need to be tightened before we wire to Scout.

---

## 7. Cost / perf

**Free (heuristic-only):**

- All name/address regex
- All `types[]`/`priceLevel`/`businessStatus` checks
- All hours-pattern checks
- Review-keyword density checks (we already join `reviews[].text` in
  `placeToScoutRow`, no extra fetch)

This is the entire current detector palette. No LLM calls. ~no extra latency
(string regex on a 4kb review-text blob is microseconds).

**Not free:**

- Photo-content inference ("is this venue physically tiny?") — would require
  Claude vision call. Recommend NOT including this in v1.
- "Is this chain location workable?" specifically — requires per-location
  curation that no Google signal answers.

**Caching:** Every detector input field is on the row at Scout time. No
re-fetch needed.

**Trap-rule evolution cost:** Each new trap is ~10 lines of TS in
`trap-detectors.ts`, ~3 fixtures. Zero migration. Adding a detector is a
1-PR change.

---

## 8. What we honestly can't detect from Google Places data alone

Important to call out, because the temptation is to over-promise:

- **Physical size.** No square-footage field. The "too small to work in" trap
  is medium confidence at best.
- **Real-time crowdedness.** Google has "popular times" but it's not in
  the standard Places API response we use.
- **Specific seating type** (stools vs benches vs couches). Reviews mention
  some of this but inconsistently.
- **Posted house rules** (the "no laptops weekends" sign on the window).
  Only catchable when a reviewer wrote about it.
- **Staff vibe / table-turn culture.** Inferred from `priceLevel` and review
  tone, never definitive.
- **Chain-location variability.** A signal that "this is a Starbucks" is
  cheap; "this specific Starbucks has 14 seats and ample outlets" requires
  per-location human curation or user-reported ground truth.

For these, the honest answer is: tag the row as suspicious, route to a human
curator queue, and prioritize user-reported feedback (which doesn't exist
yet — see the V2.x parking-lot entry on incentivized ground-truth collection).

---

## 9. Open design questions (for the follow-up PR)

1. **Override vs additive on `workabilityDelta`.** Right now a row that hits
   3 different flag traps would sum to a large delta. Cap at −5? Sum without
   cap? Pick max? Recommend cap at −5 to avoid stacking false positives.
2. **Do we re-run trap detection on existing approved rows?** Yes — a
   "backfill" mode of the detector script lets us apply new traps to the
   existing 148 rows without re-fetching Google. Cheap.
3. **Where do trap rules live for the V2 picker UI?** Probably out of scope.
   The picker shouldn't expose "trap" as a user-facing concept. The honest
   surface is the workability score the user already sees.
4. **Does the Curator see the trap suspicion in its prompt?** Recommend no
   in v1 — keep determinism. Add a flag to enable hinted-prompt mode behind
   `NEXT_PUBLIC_TRAP_HINT_CURATOR` if we want to A/B it later.
