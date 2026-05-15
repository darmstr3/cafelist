// ─────────────────────────────────────────────────────────────
// Product Roadmap — single source of truth.
// Edit this file to update the /roadmap page. Rendered in
// `src/app/roadmap/page.tsx`.
//
// Status semantics (real PM convention):
//   shipped:   live in production today
//   building:  actively in progress this week
//   next:      committed, scheduled, not started
//   exploring: under consideration, not committed
// ─────────────────────────────────────────────────────────────

export type RoadmapStatus = 'shipped' | 'building' | 'next' | 'exploring'

export interface RoadmapItem {
  title: string
  status: RoadmapStatus
  /** One-line "what" + optional "why" */
  description: string
  /** Optional rationale for the PM-curious */
  rationale?: string
  /** Date stamped when this moved to 'shipped' */
  shippedAt?: string
}

export interface RoadmapPhase {
  /** Internal id used for stable React keys */
  id: string
  /** Phase name, e.g. "Now" / "Next" / "Later" / "Maybe" */
  name: string
  /** Subtitle for context */
  subtitle: string
  items: RoadmapItem[]
}

export const ROADMAP: RoadmapPhase[] = [
  {
    id: 'now',
    name: 'Now',
    subtitle: 'Live in production',
    items: [
      {
        title: 'NYC seed: 148 wifi-verified cafés + hotel cafes',
        status: 'shipped',
        description:
          'Auto-imported from Google Places, scored from review text, filtered to spots with confirmed wifi. Eating-only diners removed.',
        rationale:
          "Wifi is a non-negotiable for the target user. Apple Maps and Google return restaurants when you search 'coffee shop' — we don't.",
        shippedAt: '2026-05-02',
      },
      {
        title: 'Yes / Ok / No verdict signals',
        status: 'shipped',
        description:
          'Color-coded scannable chips for Wi-Fi, Outlets, Quiet, Late on every card.',
        rationale:
          "Numerical scores like '5.6 WIFI' tell a user nothing. Nomad List proved that semantic verdicts read in <1s.",
        shippedAt: '2026-05-02',
      },
      {
        title: 'Open-now / Late-night / 24hr filters',
        status: 'shipped',
        description:
          'One-tap quick-filter pills above the directory. Open Now is pre-toggled by default.',
        shippedAt: '2026-05-02',
      },
      {
        title: 'Mobile-first 2-column grid',
        status: 'shipped',
        description:
          'Twice the density of v0. Apple/Google Maps deep links open the right app on each device.',
        shippedAt: '2026-05-02',
      },
      {
        title: 'In-person verification flow',
        status: 'shipped',
        description:
          "/admin lets you flip any spot from auto-scored to verified, correct any field (wifi, outlets, scores), and add visit notes from your phone.",
        rationale:
          "The moat: a curator-verified row is more trustworthy than any aggregate review score.",
        shippedAt: '2026-05-02',
      },
      {
        title: 'Maintenance agents on Supabase Edge Functions',
        status: 'shipped',
        description:
          'closure-watch (daily) auto-rejects permanently-closed places. verification-flagger (weekly) surfaces stale rows. import-runner (on-demand) seeds new cities.',
        rationale:
          'Self-improving list quality with zero ongoing manual work.',
        shippedAt: '2026-05-02',
      },
    ],
  },

  {
    id: 'next',
    name: 'Next',
    subtitle: 'This week',
    items: [
      {
        title: 'Custom domain + final name',
        status: 'shipped',
        description:
          'Live at cafelist.app. Rebranded from GroundWork: wordmark, OG share image, favicon, Apple touch icon all updated.',
        rationale:
          "Real domain converts a 'side project' into a portfolio piece you can actually link to.",
        shippedAt: '2026-05-02',
      },
      {
        title: 'Google sign-in',
        status: 'next',
        description:
          'Supabase Auth with Google OAuth. Replaces anonymous review form with attributed reviews.',
        rationale:
          'Without identity, save / lists / community features are impossible.',
      },
      {
        title: 'Save / heart spots',
        status: 'next',
        description:
          'One-tap save on any card. Personal /favorites page. The minimum value a logged-in user gets.',
      },
      {
        title: 'Curated lists',
        status: 'next',
        description:
          'Build named lists like "Williamsburg coffee day" or "Late night work." Drag spots in, share via public URL.',
        rationale:
          "Killer portfolio feature: 'Donovan's NYC remote work list' becomes a shareable artifact.",
      },
    ],
  },

  {
    id: 'later',
    name: 'Later',
    subtitle: 'This month',
    items: [
      {
        title: 'Location-based discovery — "near me"',
        status: 'next',
        description:
          'Browser geolocation → spots sorted by distance. Filter to "within 10 min walk."',
        rationale:
          "Solves the 'I have 30 min before my next thing, where do I go' use case directly.",
      },
      {
        title: 'City #2',
        status: 'exploring',
        description:
          'Trigger import-runner with new queries. LA, Boston, or Chicago — wherever the early users are.',
      },
      {
        title: 'Submit-a-spot 2.0',
        status: 'exploring',
        description:
          'Authenticated submissions with photo upload. Submitter gets credit on the spot detail page once approved.',
      },
      {
        title: 'Visit log',
        status: 'exploring',
        description:
          "Mark a spot as 'visited' with a date. Builds your personal year-in-coffee timeline over time.",
      },
    ],
  },

  {
    id: 'maybe',
    name: 'Maybe',
    subtitle: 'Parking lot — ideas worth exploring once we have users',
    items: [
      {
        title: 'Curated tours: "SoHo coffee crawl"',
        status: 'exploring',
        description:
          'Pre-built thematic itineraries. Same data structure as user lists, but authored and featured on the homepage.',
      },
      {
        title: 'Plan-a-hangout',
        status: 'exploring',
        description:
          'Pick 2 friends + neighborhood + vibe → returns 3 matching spots. LLM-assisted suggestion.',
        rationale:
          "Airbnb's 'experiences' for cafés.",
      },
      {
        title: 'Wait-spots filter',
        status: 'exploring',
        description:
          '"I have 30 min before my next thing, find somewhere to sit nearby." Geolocation + open-now + decent score.',
      },
      {
        title: 'Community: follow curators, comment on spots',
        status: 'exploring',
        description:
          "Defer until there's a community to moderate. Comments are a moderation problem before they're a content problem.",
      },
    ],
  },
]
