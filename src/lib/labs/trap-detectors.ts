// ─────────────────────────────────────────────────────────────
// Cafelist trap detectors — declarative rules for spotting
// "Google Maps trap" venues that LOOK workable on paper but FAIL
// the 2-hour-laptop test in real life.
//
// Single source of truth for the trap layer. Mirrors the data-only
// pattern of modes.ts:
//   - no UI imports
//   - no runtime side effects
//   - no LLM dependencies
//   - all signals reference fields Scout already collects from
//     Google Places (or fields explicitly flagged as
//     "requires data expansion" in the design doc)
//
// Wiring this into Scout + Curator is a follow-up PR — see
// docs/EVAL_TRAPS.md §5 for the integration plan. This module
// is the inert taxonomy; the runtime evaluator that consumes
// TRAP_DETECTORS lives in the follow-up.
//
// See:
//   - docs/EVAL_TRAPS.md       (taxonomy + rationale)
//   - src/lib/labs/modes.ts    (declarative-data pattern)
//   - src/lib/scout.ts         (what fields are populated at Scout time)
//   - src/lib/google-places.ts (GPPlace + raw types[] vocabulary)
// ─────────────────────────────────────────────────────────────

import type { SpotType } from '@/types'

// ── Category ─────────────────────────────────────────────────
// Groups the detectors by failure mode for dashboard / audit
// readability. Adding a category: extend the union and add
// fixtures under that category in the test file.

export type TrapCategory =
  | 'food_first'      // Restaurants/diners presenting as cafés
  | 'too_small'       // Stand-up bars, walk-up windows, micro-cafés
  | 'gated'           // Members-only, hotel-guest-only, coworking-gated
  | 'hostile_seating' // Anti-laptop policy, drive-thru, lounges, etc.
  | 'data_quality'    // Closed-permanently, duplicates, stale listings
  | 'other'           // Chains, photogenic-only, edge cases

// ── Action ───────────────────────────────────────────────────
// What the trap layer does when a detector fires. Distinct from
// "what the Curator does" — that's a downstream choice. See
// docs/EVAL_TRAPS.md §4.
//
//   reject          — do not insert into spots at all
//   flag_downgrade  — insert, but subtract workabilityDelta from
//                     the Curator score
//   prompt_human    — insert as status='pending' for human review
//                     instead of auto-approve

export type TrapAction = 'reject' | 'flag_downgrade' | 'prompt_human'

// ── Confidence ───────────────────────────────────────────────
// How much to trust the detector. Used by the future audit UI
// to surface the high-confidence rules and de-emphasize the
// noisy ones. Does NOT change the action — that's a separate
// editorial decision encoded in `action`.
//
//   high   — pattern-based or explicit Google field
//   medium — review-keyword based, single source
//   low    — soft signals, prone to false positives

export type TrapConfidence = 'high' | 'medium' | 'low'

// ── Signal shapes ────────────────────────────────────────────
// OR-of-signals: any signal in the array firing triggers the
// detector. AND composition is supported via the `composite`
// kind, which nests sub-signals with an explicit `op`.
//
// All signal kinds reference data that EITHER:
//   (a) is already on the Spot row (after Scout) — see Spot in
//       src/types/index.ts and placeToScoutRow in src/lib/scout.ts
//   (b) is on the GPPlace returned by Google Places (raw types[],
//       priceLevel, businessStatus, userRatingCount, rating) but
//       currently dropped by Scout. These are flagged on the
//       `source` field below as 'gp_raw' so the integration PR
//       knows to widen what Scout persists.

export type SignalSource = 'spot_row' | 'gp_raw' | 'derived'

export type SignalKind =
  | 'name_pattern'
  | 'address_pattern'
  | 'category_match'
  | 'review_keyword'
  | 'attribute_check'
  | 'hours_check'
  | 'metadata'
  | 'composite'

/** Regex match against `spot.name` (case-insensitive). */
export interface NamePatternSignal {
  kind: 'name_pattern'
  source: 'spot_row'
  /** Stored as a string (not RegExp) so the data module stays JSON-
   *  serializable and the regex can be inspected/audited in a UI.
   *  Compiled at runtime by the evaluator. */
  pattern: string
  /** Optional flags. Default 'i'. */
  flags?: string
  description: string
}

/** Regex match against `spot.address`. */
export interface AddressPatternSignal {
  kind: 'address_pattern'
  source: 'spot_row'
  pattern: string
  flags?: string
  description: string
}

/** Match against Google Places raw `types[]` array OR the mapped
 *  `spot.type`. `gp_raw` types include strings like 'restaurant',
 *  'bar', 'drive_through', 'grocery_store', 'book_store',
 *  'gym', 'museum', 'tourist_attraction', 'coworking_space',
 *  'meal_takeaway', etc. Spot types are the narrower SpotType
 *  union. */
export interface CategoryMatchSignal {
  kind: 'category_match'
  source: 'gp_raw' | 'spot_row'
  /** Raw Google types when source='gp_raw'; SpotType values when
   *  source='spot_row'. ANY match fires. */
  values: string[]
  /** Optional: require ALL values to be present (default false = ANY). */
  requireAll?: boolean
  description: string
}

/** Keyword scan of joined review text (lowercase). Fires when the
 *  total hit count meets `minHits`. Scout already joins reviews into
 *  a lowercase blob in placeToScoutRow — the evaluator should reuse
 *  the same join. */
export interface ReviewKeywordSignal {
  kind: 'review_keyword'
  source: 'derived'
  keywords: string[]
  /** Minimum total keyword occurrences across the joined text. */
  minHits: number
  description: string
}

/** Check a structured boolean / enum / numeric field on the spot
 *  row. Used for laptop_friendly=false caps, noise_level='loud'
 *  caps, etc. */
export interface AttributeCheckSignal {
  kind: 'attribute_check'
  source: 'spot_row' | 'gp_raw'
  field: string                   // e.g. 'laptop_friendly', 'priceLevel', 'userRatingCount'
  /** One of: equals, notEquals, gte, lte, isFalsy, isTruthy. */
  op: 'equals' | 'notEquals' | 'gte' | 'lte' | 'isFalsy' | 'isTruthy'
  /** Compared value. Omitted for isFalsy/isTruthy. */
  value?: string | number | boolean
  description: string
}

/** Hours-shape check. Currently supports:
 *   - opensAfter: smallest open time across the week is later than HH:MM
 *   - closesAfter: largest close time across the week is later than HH:MM
 *   - closesBefore: largest close time is earlier than HH:MM
 *   - missing: hours object is null/empty
 *  Hours object lives on Spot.hours per src/types/index.ts. */
export interface HoursCheckSignal {
  kind: 'hours_check'
  source: 'spot_row'
  check: 'opensAfter' | 'closesAfter' | 'closesBefore' | 'missing'
  /** HH:MM 24h. Required for the time-based checks; omitted for 'missing'. */
  threshold?: string
  description: string
}

/** Catch-all for signals on Place metadata that don't fit the
 *  shapes above. v1 uses this for businessStatus only. */
export interface MetadataSignal {
  kind: 'metadata'
  source: 'gp_raw'
  field: 'businessStatus'
  value: 'CLOSED_PERMANENTLY' | 'CLOSED_TEMPORARILY' | 'OPERATIONAL'
  description: string
}

/** AND/OR combine sub-signals. Useful for "name matches X AND
 *  types includes Y" patterns. */
export interface CompositeSignal {
  kind: 'composite'
  source: 'derived'
  op: 'and' | 'or'
  signals: DetectionSignal[]
  description: string
}

export type DetectionSignal =
  | NamePatternSignal
  | AddressPatternSignal
  | CategoryMatchSignal
  | ReviewKeywordSignal
  | AttributeCheckSignal
  | HoursCheckSignal
  | MetadataSignal
  | CompositeSignal

// ── TrapDetector shape ───────────────────────────────────────

export interface TrapDetector {
  /** snake_case identifier. Stable across versions — referenced by
   *  the spot row's `trap_rules` column once wired up. Renaming is
   *  a breaking change. */
  id: string
  category: TrapCategory
  /** 1–2 sentences: what this trap is. Read by humans in the audit
   *  dashboard, not by the LLM. */
  description: string
  /** OR-of-signals. Any one firing triggers the detector. */
  signals: DetectionSignal[]
  action: TrapAction
  /** Workability points to SUBTRACT from the Curator score. Only
   *  meaningful when action='flag_downgrade'. Subtraction clamps at
   *  0 at the integration site, not here. Range: 0.5 to 5.0 in
   *  current detectors. */
  workabilityDelta?: number
  /** Real-world spot names that exemplify this trap. Two purposes:
   *   - fixture seeding for the test suite
   *   - human-readable audit context ("the 'food_first' rule was
   *     designed to catch venues like Veselka") */
  examples: string[]
  confidence: TrapConfidence
  /** Optional notes about limitations / known false positives.
   *  Read by humans during rule review. */
  caveats?: string
  /** Whether the detector references Scout-collected data or
   *  requires data Scout doesn't currently store. If true, the
   *  integration PR must widen Scout's persist shape first.
   *  Default false. */
  requiresDataExpansion?: boolean
}

// ── TRAP_DETECTORS ───────────────────────────────────────────
//
// Acceptance: removing an entry here removes the detector from
// the trap layer with no other code change required. The future
// runtime evaluator iterates this array.
//
// Confidence labels are honest, not aspirational. A "low" detector
// means we expect false positives and route through prompt_human
// rather than auto-downgrade.

export const TRAP_DETECTORS: TrapDetector[] = [
  // ── data_quality: hard rejects first so the cheaper detectors
  // short-circuit before the more expensive ones run.

  {
    id: 'permanently_closed',
    category: 'data_quality',
    description:
      'Listing is marked permanently closed by Google. Scout already filters these at text-search time, but the Place Details response can disagree — re-check on the details object too.',
    signals: [
      {
        kind: 'metadata',
        source: 'gp_raw',
        field: 'businessStatus',
        value: 'CLOSED_PERMANENTLY',
        description: 'Google businessStatus=CLOSED_PERMANENTLY on the details response',
      },
    ],
    action: 'reject',
    examples: ['(any spot whose Google record flips after Scout fetches it)'],
    confidence: 'high',
  },

  {
    id: 'temporarily_closed',
    category: 'data_quality',
    description:
      'Google has the venue marked as temporarily closed. Often the right move is to delay insert rather than reject outright, but for v1 we prompt human review.',
    signals: [
      {
        kind: 'metadata',
        source: 'gp_raw',
        field: 'businessStatus',
        value: 'CLOSED_TEMPORARILY',
        description: 'Google businessStatus=CLOSED_TEMPORARILY',
      },
    ],
    action: 'prompt_human',
    examples: [],
    confidence: 'high',
  },

  {
    id: 'closed_in_reviews',
    category: 'data_quality',
    description:
      'Review text mentions the venue being out of business / closed for good, even though Google still lists OPERATIONAL. Common drift case for COVID-era casualties still on the map.',
    signals: [
      {
        kind: 'review_keyword',
        source: 'derived',
        keywords: [
          'closed permanently',
          'permanently closed',
          'out of business',
          'no longer open',
          'shut down',
          'they closed',
          'this place closed',
        ],
        minHits: 2,
        description: 'multiple reviewers reporting the venue is closed',
      },
    ],
    action: 'prompt_human',
    examples: [],
    confidence: 'medium',
    caveats: '"closed at 5pm" can hit "closed" — minHits=2 + phrase form mitigates but human review still safest.',
  },

  // ── gated: members-only / coworking. Hard reject — no version of
  // "workable" applies when you can't get in the door.

  {
    id: 'coworking_gated',
    category: 'gated',
    description:
      'Venue is the cafe arm of a members-only coworking / social club. Public can\'t walk in. Sometimes still listed publicly on Google.',
    signals: [
      {
        kind: 'name_pattern',
        source: 'spot_row',
        pattern: '\\b(wework|industrious|the wing|soho house|neuehouse|spring place|chief\\b|core club)\\b',
        description: 'name matches a known members-only coworking / club brand',
      },
      {
        kind: 'category_match',
        source: 'gp_raw',
        values: ['coworking_space'],
        description: 'Google types[] includes coworking_space (rare but exists)',
      },
      {
        kind: 'review_keyword',
        source: 'derived',
        keywords: ['members only', 'you need to be a member', 'private members club', 'member access only'],
        minHits: 1,
        description: 'reviewers explicitly call out the gating',
      },
    ],
    action: 'reject',
    examples: ['Soho House café', 'NeueHouse coffee bar', 'Industrious cafe spots'],
    confidence: 'high',
    caveats: 'WeWork hot-desks used to be technically purchasable; if they re-open day passes this rule may over-fire.',
  },

  // ── hostile_seating: drive-thru / takeout / explicit no-laptop rules.

  {
    id: 'drive_thru_only',
    category: 'hostile_seating',
    description:
      'Drive-thru-only location. No interior seating. The classic suburban / highway Starbucks or Dunkin\' counter.',
    signals: [
      {
        kind: 'category_match',
        source: 'gp_raw',
        values: ['drive_through'],
        description: 'Google types[] includes drive_through',
      },
      {
        kind: 'name_pattern',
        source: 'spot_row',
        pattern: '\\b(drive[\\s-]?thru|drive[\\s-]?through)\\b',
        description: 'name contains "drive-thru"',
      },
    ],
    action: 'reject',
    examples: ['highway-rest-stop Starbucks', 'standalone Dunkin\' drive-thrus'],
    confidence: 'high',
  },

  {
    id: 'takeout_only_reviews',
    category: 'hostile_seating',
    description:
      'Reviews describe the venue as takeout/grab-and-go with no usable seating. Catches counter-service kiosks and food-hall stalls that Google still calls a "cafe".',
    signals: [
      {
        kind: 'review_keyword',
        source: 'derived',
        keywords: [
          'takeout only',
          'take out only',
          'to-go only',
          'grab and go',
          'no seating',
          'no place to sit',
          'standing room only',
          'no seats',
        ],
        minHits: 2,
        description: 'multiple mentions of no-seating / takeout-only',
      },
    ],
    action: 'flag_downgrade',
    workabilityDelta: 4.0,
    examples: ['Penn Station coffee kiosks', 'Chelsea Market stalls', 'most airport "cafes"'],
    confidence: 'medium',
    caveats: '"to-go cups" is a common positive phrase — keep keyword list as full phrases, not single words.',
  },

  {
    id: 'explicit_no_laptop',
    category: 'hostile_seating',
    description:
      'Reviews report explicit anti-laptop policies. "No laptops weekends", "30 minute table limit", "laptops only before 11am". When a reviewer wrote this, it is almost always real.',
    signals: [
      {
        kind: 'review_keyword',
        source: 'derived',
        keywords: [
          'no laptops',
          'laptops not allowed',
          'laptop policy',
          'no computers',
          'table limit',
          '30 minute',
          '30-minute',
          'one hour limit',
          '1 hour limit',
          'laptops only until',
          'weekend no laptops',
          'no laptops on weekends',
        ],
        minHits: 1,
        description: 'unambiguous laptop / time-limit policy phrasing',
      },
    ],
    action: 'flag_downgrade',
    workabilityDelta: 4.0,
    examples: ['Devoción on weekends', 'historical Joe Coffee Waverly policy', 'some Stumptown locations'],
    confidence: 'high',
    caveats: 'A high-delta flag rather than reject so a 9.0-rated spot that ALSO has weekend laptop bans still surfaces at 5.0 for weekday queries.',
  },

  {
    id: 'lobby_bar_pivot',
    category: 'hostile_seating',
    description:
      'Hotel "cafe" that is structurally a lobby cocktail lounge — opens late, runs DJ programming, has bar-type Google categorisation despite serving espresso.',
    signals: [
      {
        kind: 'composite',
        source: 'derived',
        op: 'and',
        signals: [
          {
            kind: 'category_match',
            source: 'spot_row',
            values: ['hotel_lobby'] as SpotType[],
            description: 'mapped type is hotel_lobby',
          },
          {
            kind: 'composite',
            source: 'derived',
            op: 'or',
            signals: [
              {
                kind: 'category_match',
                source: 'gp_raw',
                values: ['bar', 'night_club'],
                description: 'Google types[] includes bar or night_club',
              },
              {
                kind: 'hours_check',
                source: 'spot_row',
                check: 'opensAfter',
                threshold: '16:00',
                description: 'all weekdays open after 4pm — daytime workspace this is not',
              },
              {
                kind: 'review_keyword',
                source: 'derived',
                keywords: ['cocktail', 'dj', 'happy hour', 'live music', 'speakeasy'],
                minHits: 3,
                description: 'heavy bar-programming review density',
              },
            ],
            description: 'any of: bar in types, late-open hours, or bar-programming reviews',
          },
        ],
        description: 'hotel lobby AND bar-leaning signal',
      },
    ],
    action: 'flag_downgrade',
    workabilityDelta: 2.0,
    examples: ['The Bowery Hotel lobby bar', 'Public Hotel lounge', 'Equinox Hotel lobby'],
    confidence: 'medium',
    caveats: 'Will NOT fire for legitimately-workable hotel lobbies (Ace, Freehand, Hoxton) because those open in the morning and lack bar tagging.',
  },

  // ── food_first: diners / restaurants presenting as cafes.

  {
    id: 'diner_branded',
    category: 'food_first',
    description:
      'Name contains a giveaway food-venue word ("Diner", "Deli", "Restaurant", "Grill", "Bistro", "Trattoria"). Even with espresso, the social contract is restaurant.',
    signals: [
      {
        kind: 'name_pattern',
        source: 'spot_row',
        pattern: '\\b(diner|deli|bistro|trattoria|brasserie|kitchen|grill|restaurant|tavern|chophouse|steakhouse|pizzeria)\\b',
        description: 'name contains a restaurant-genre word',
      },
    ],
    action: 'flag_downgrade',
    workabilityDelta: 3.0,
    examples: ['Veselka', 'Tom\'s Restaurant', 'B&H Dairy', 'La Bonbonniere'],
    confidence: 'high',
    caveats: '"Diner" in the name is high signal. False positives possible for "Bistro Coffee" rebrands — keep delta at 3.0 not reject so a high Curator score can still surface them.',
  },

  {
    id: 'restaurant_typed',
    category: 'food_first',
    description:
      'Google types[] includes restaurant / meal_takeaway alongside cafe — the venue is structurally a food spot that also sells coffee. Catches the Veselka-class of trap where mapPlaceType lands on coffee_shop.',
    signals: [
      {
        kind: 'composite',
        source: 'derived',
        op: 'and',
        signals: [
          {
            kind: 'category_match',
            source: 'gp_raw',
            values: ['restaurant'],
            description: 'Google types[] includes restaurant',
          },
          {
            kind: 'category_match',
            source: 'spot_row',
            values: ['coffee_shop'] as SpotType[],
            description: 'AND our type mapping landed on coffee_shop',
          },
        ],
        description: 'cafe-typed by us, restaurant-typed by Google — the classic diner trap',
      },
    ],
    action: 'flag_downgrade',
    workabilityDelta: 2.5,
    examples: ['Veselka', 'Russ & Daughters Café (borderline)'],
    confidence: 'high',
    requiresDataExpansion: true,
  },

  {
    id: 'food_density_in_reviews',
    category: 'food_first',
    description:
      'Reviews are dense with food / meal / dining language relative to coffee language. Soft signal for "this is a restaurant whose coffee gets reviewed."',
    signals: [
      {
        kind: 'review_keyword',
        source: 'derived',
        keywords: [
          'brunch',
          'lunch menu',
          'dinner menu',
          'entrée',
          'entree',
          'appetizer',
          'main course',
          'waiter',
          'waitress',
          'server',
          'reservation',
          'host stand',
        ],
        minHits: 4,
        description: 'food-service vocabulary density ≥ 4 hits',
      },
    ],
    action: 'flag_downgrade',
    workabilityDelta: 1.5,
    examples: ['all-day cafe concepts that morph into restaurants at lunch'],
    confidence: 'medium',
    caveats: 'Genuine cafes with food menus will trip this. Low delta accordingly.',
  },

  // ── food_first / hostile_seating: bar-hybrid pivot venues.

  {
    id: 'bar_hybrid',
    category: 'food_first',
    description:
      'All-day cafe that pivots to wine bar / cocktail lounge in the evening. Workable in the morning but the score should reflect that this is a half-day venue at best.',
    signals: [
      {
        kind: 'composite',
        source: 'derived',
        op: 'and',
        signals: [
          {
            kind: 'category_match',
            source: 'gp_raw',
            values: ['bar', 'liquor_store', 'night_club'],
            description: 'Google types[] includes bar / liquor / nightclub',
          },
          {
            kind: 'hours_check',
            source: 'spot_row',
            check: 'closesAfter',
            threshold: '22:00',
            description: 'closes after 10pm (late close = service pivot)',
          },
        ],
        description: 'bar typing AND late close',
      },
      {
        kind: 'name_pattern',
        source: 'spot_row',
        pattern: '\\b(bar|wine|brewery|tap|spirits|cocktail|natural wine)\\b',
        description: 'name explicitly bar-themed',
      },
    ],
    action: 'flag_downgrade',
    workabilityDelta: 2.0,
    examples: ['Williamsburg all-day cafes that pivot at 4pm'],
    confidence: 'medium',
  },

  // ── too_small: Italian-style espresso bars and walk-up windows.

  {
    id: 'espresso_bar_branded',
    category: 'too_small',
    description:
      'Name uses Italian / European espresso-bar vocabulary that signals stand-up culture. "Caffè X" with no English seating language is almost always a 16-square-foot stand-up bar.',
    signals: [
      {
        kind: 'name_pattern',
        source: 'spot_row',
        pattern: '\\b(espresso bar|caff[èe]\\b|kiosk|stand|walk[\\s-]?up|window|to[\\s-]?go)\\b',
        description: 'name contains a stand-up-espresso-culture word',
      },
    ],
    action: 'flag_downgrade',
    workabilityDelta: 2.5,
    examples: ['Fellini Coffee', 'Fellini Cucina', 'Ralph\'s Coffee kiosks', 'Eataly espresso counter'],
    confidence: 'high',
    caveats: 'Some "Caffè" venues are full-size cafes (e.g. Caffè Reggio). The pattern is high-precision when combined with low userRatingCount, but we flag rather than reject so the Curator can still surface the exceptions.',
  },

  {
    id: 'tiny_reviews',
    category: 'too_small',
    description:
      'Reviews describe the venue as tiny / cramped / no-seating in absolute terms (not "tiny but cozy"). Medium confidence — humans say this about places we WANT to surface too.',
    signals: [
      {
        kind: 'review_keyword',
        source: 'derived',
        keywords: [
          'standing room only',
          'no place to sit',
          'no seats',
          'no seating',
          'tiny space',
          'extremely small',
          'cramped',
          'hole in the wall',
        ],
        minHits: 2,
        description: 'two or more no-seating / cramped phrases',
      },
    ],
    action: 'prompt_human',
    examples: ['the West Village Fellini', 'many Italian-style espresso bars'],
    confidence: 'low',
    caveats: '"hole in the wall" is positive in some review styles. prompt_human rather than auto-downgrade.',
  },

  // ── gated / hostile_seating: cafes inside non-cafe venues.

  {
    id: 'inside_host_venue',
    category: 'gated',
    description:
      'Café is inside a grocery store / bookstore / gym / department store. Workability varies wildly. Human curator should decide.',
    signals: [
      {
        kind: 'name_pattern',
        source: 'spot_row',
        pattern: '\\b(whole foods|equinox|barnes\\s*&\\s*noble|nordstrom|bergdorf|bloomingdale|target|mcnally jackson|the strand|housing works)\\b',
        description: 'name contains a known host-venue brand',
      },
      {
        kind: 'address_pattern',
        source: 'spot_row',
        pattern: '\\b(inside|@|at)\\s+(whole foods|equinox|barnes|nordstrom|bergdorf)\\b',
        description: 'address explicitly says "inside <host venue>"',
      },
      {
        kind: 'category_match',
        source: 'gp_raw',
        values: ['grocery_store', 'book_store', 'department_store', 'gym', 'museum', 'tourist_attraction'],
        description: 'Google types[] includes a non-cafe host-venue category',
      },
    ],
    action: 'prompt_human',
    examples: ['Whole Foods coffee bars', 'McNally Jackson Café', 'Bergdorf Goodman café', 'Strand cafe'],
    confidence: 'medium',
    caveats: 'Housing Works and a handful of bookstore cafes ARE workable. Hence prompt_human, not auto-downgrade.',
    requiresDataExpansion: true,
  },

  // ── other: chains.

  {
    id: 'variable_chain',
    category: 'other',
    description:
      'Major chain whose individual locations vary wildly in workability. We CAN cheaply detect chain membership; we CANNOT detect whether this specific branch is workable from Google data alone.',
    signals: [
      {
        kind: 'name_pattern',
        source: 'spot_row',
        // Anchored to start to avoid matching e.g. "Just Like Starbucks" reviews; chains usually lead with brand.
        pattern: '^(starbucks|blue bottle|la colombe|gregorys|bluestone lane|joe coffee|stumptown|peet\'?s|dunkin\'?|tim hortons|costa)\\b',
        flags: 'i',
        description: 'name starts with a known chain brand',
      },
    ],
    action: 'prompt_human',
    examples: ['Starbucks #4127 (any tourist-zone branch)', 'random Blue Bottle kiosks'],
    confidence: 'low',
    caveats: 'Soft rule. Many chain branches are excellent. The honest move is human curation for chains, not auto-downgrade.',
  },

  // ── other: photogenic-only.

  {
    id: 'instagram_cafe',
    category: 'other',
    description:
      'High-rating, high-review-count venue whose review text emphasizes aesthetics over usability. Often has stool / bench seating designed for photos, not laptops.',
    signals: [
      {
        kind: 'composite',
        source: 'derived',
        op: 'and',
        signals: [
          {
            kind: 'attribute_check',
            source: 'gp_raw',
            field: 'userRatingCount',
            op: 'gte',
            value: 1000,
            description: 'heavy review presence',
          },
          {
            kind: 'attribute_check',
            source: 'gp_raw',
            field: 'rating',
            op: 'gte',
            value: 4.5,
            description: 'high star rating',
          },
          {
            kind: 'review_keyword',
            source: 'derived',
            keywords: ['instagram', 'aesthetic', 'for the gram', 'photo spot', 'instagrammable', 'photo opportunity'],
            minHits: 2,
            description: 'reviewers emphasize the photo angle',
          },
        ],
        description: 'popular + photogenic by review consensus',
      },
    ],
    action: 'flag_downgrade',
    workabilityDelta: 1.5,
    examples: ['Maman (some locations)', 'certain Brooklyn specialty roasters', 'Bibble & Sip'],
    confidence: 'low',
    caveats: 'Photogenic AND workable spots exist (e.g. some Maman locations). Soft penalty only.',
    requiresDataExpansion: true,
  },

  // ── other: tourist-zone.

  {
    id: 'tourist_zone',
    category: 'other',
    description:
      'Venue in a high-tourist-density area (Times Square, Little Italy, Mulberry St). Turn pressure higher than the structured signals suggest.',
    signals: [
      {
        kind: 'address_pattern',
        source: 'spot_row',
        pattern: '\\b(times square|mulberry st|little italy|south street seaport|battery park)\\b',
        description: 'address sits in a known tourist zone',
      },
    ],
    action: 'flag_downgrade',
    workabilityDelta: 1.0,
    examples: ['Caffè Reggio at peak tourist hours', 'most Mulberry St cafes', 'Times Square Starbucks'],
    confidence: 'low',
    caveats: 'Soft. Caffè Reggio late evening is genuinely workable. Address-based heuristic is broad.',
  },

  // ── too_small / food_first: stand-up + restaurant hours combo.

  {
    id: 'short_hours_food',
    category: 'food_first',
    description:
      'Open lunch-hours only (e.g. closes by 4pm) with food vocabulary — points to a lunch counter rather than a coffee destination.',
    signals: [
      {
        kind: 'composite',
        source: 'derived',
        op: 'and',
        signals: [
          {
            kind: 'hours_check',
            source: 'spot_row',
            check: 'closesBefore',
            threshold: '16:00',
            description: 'closes by 4pm',
          },
          {
            kind: 'review_keyword',
            source: 'derived',
            keywords: ['lunch', 'sandwich', 'soup', 'salad', 'bagel', 'breakfast sandwich'],
            minHits: 3,
            description: 'lunch-counter vocabulary',
          },
        ],
        description: 'short hours AND food vocabulary',
      },
    ],
    action: 'flag_downgrade',
    workabilityDelta: 1.5,
    examples: ['lunch-counter delis', 'bagel shops that close at 3pm'],
    confidence: 'medium',
  },

  // ── hostile_seating: attribute-driven structured fallback.

  {
    id: 'no_laptop_friendly_flag',
    category: 'hostile_seating',
    description:
      'The structured laptop_friendly flag derived from reviews is false. Single-source signal but cheap to apply as a soft penalty in case the Curator over-rated.',
    signals: [
      {
        kind: 'attribute_check',
        source: 'spot_row',
        field: 'laptop_friendly',
        op: 'isFalsy',
        description: 'spot.laptop_friendly is false',
      },
    ],
    action: 'flag_downgrade',
    workabilityDelta: 1.0,
    examples: [],
    confidence: 'low',
    caveats: 'laptop_friendly is derived from a coarse keyword match in placeToScoutRow. False negatives common. Hence low delta.',
  },

  // ── data_quality: missing hours.

  {
    id: 'missing_hours',
    category: 'data_quality',
    description:
      'No hours object returned by Google. Often correlates with stale listings or short-hours pop-ups. Soft signal — prompt human review rather than reject.',
    signals: [
      {
        kind: 'hours_check',
        source: 'spot_row',
        check: 'missing',
        description: 'spot.hours is null or empty',
      },
    ],
    action: 'prompt_human',
    examples: [],
    confidence: 'medium',
  },
]

// ── Type guards / accessors ──────────────────────────────────
// Tiny convenience helpers so consumers don't redefine these
// inline. The runtime evaluator (follow-up PR) will use these.

/** All detector ids — useful for the spot row's `trap_rules` enum
 *  and for the audit dashboard's "all known rules" view. */
export const TRAP_DETECTOR_IDS: ReadonlyArray<string> = TRAP_DETECTORS.map(
  (d) => d.id
)

/** Group detectors by category. Computed at module load. */
export const TRAP_DETECTORS_BY_CATEGORY: Record<TrapCategory, TrapDetector[]> = {
  food_first: [],
  too_small: [],
  gated: [],
  hostile_seating: [],
  data_quality: [],
  other: [],
}
for (const detector of TRAP_DETECTORS) {
  TRAP_DETECTORS_BY_CATEGORY[detector.category].push(detector)
}

/** Find a detector by id. Returns undefined when not found — callers
 *  should treat unknown ids as data corruption (e.g. a `trap_rules`
 *  column entry whose detector was removed in a later PR). */
export function findTrapDetector(id: string): TrapDetector | undefined {
  return TRAP_DETECTORS.find((d) => d.id === id)
}
