# GroundWork — Launch Brand & Design Brief

**Status:** Functionally complete app, codebase reviewed at `~/Desktop/Coffee List/`
**Goal:** Ship a premium, scannable, instantly-useful directory for remote workers
**Constraints:** No full redesign. Refine what exists. Ship in 1–2 days.

---

## 0. Where the app stands today

Anchored to what's actually in the code:

- **Current name:** GroundWork
- **Current tagline:** "Verified work-friendly cafes & hotel lobbies"
- **Current palette:** Dark Linear/Nomad-List style — `#0a0a0f` background, indigo `#7c6af7` accent
- **Card pattern:** Cover photo → open/closed badge → 4-signal grid (Wi-Fi · Outlets · Quiet · Late) as Yes / Kinda / No / Unknown chips → vibe tags
- **Detail page:** 6 numeric score blocks (0–10) + amenity icons + reviews + hours + embedded Google Map
- **Trust signal:** "VERIFIED ✓" vs "AUTO" pill on each card

The bones are good. The brand is the gap.

---

## 1. Naming + Brand Direction

### 10 candidates

| # | Name | Vibe | Domain |
|---|------|------|--------|
| 1 | **GroundWork** *(current)* | Coffee grounds + getting groundwork done. Already shipped. | groundwork.app / .co |
| 2 | **Roost** | Place to settle and work. Calm, lifestyle. | roost.cafe / .co |
| 3 | **Outpost** | Remote-work explorer feel. Slightly adventurous. | outpost.coffee / .app |
| 4 | **Perch** | Short, specific, ownable. "Find a perch." | perch.app / .co |
| 5 | **Loci** | Latin for "places." Abstract, premium, unowned. | loci.app |
| 6 | **Brewlist** | Direct Nomad List parallel. Self-describing. | brewlist.com / .co |
| 7 | **Hush** | Foregrounds quiet/focus. Minimal, premium. | hush.coffee / .app |
| 8 | **Common** | Communal, unpretentious. Strong wordmark potential. | common.cafe |
| 9 | **Steepwork** | Coffee/tea + work. Memorable, slightly playful. | steepwork.com |
| 10 | **Settle** | "Settle in." Lifestyle, calm, action-oriented. | settle.app / .co |

### Top 3 — picked

1. **GroundWork (keep)** — It's already in the product, on the homepage, and on-brief: "grounds" reads as both coffee and foundation. Renaming this late costs more than it gains. Domain: prefer `groundwork.cafe` if available, else `groundwork.app`. *Action: keep.*
2. **Roost** — If GroundWork's `.com`/`.app` is unavailable or trademarked, Roost is the cleanest pivot: warm, lifestyle-first, single syllable, no startup-y stem. `roost.cafe` reads beautifully.
3. **Outpost** — Best fit if you ever expand beyond cafés to coworking, hotel lobbies, libraries. The current tagline already mentions hotel lobbies — Outpost stretches further than GroundWork does.

**Recommendation: ship as GroundWork.** Spend the naming-debate hours on the palette and detail page instead.

---

## 2. Color System

The current dark-indigo palette reads as a developer tool, not a café guide. Pivot to **warm light-mode primary, with a warm-dark companion**. Coffee-inspired tones, no startup blue.

### Primary palette — Light (recommended default)

| Token | Hex | Role |
|---|---|---|
| `--background` | `#FAF7F2` | Oat-milk cream — main page bg |
| `--surface` | `#FFFFFF` | Cards |
| `--surface-2` | `#F1ECE3` | Parchment — input/chips bg |
| `--surface-3` | `#E8E0D2` | Hover states, photo placeholders |
| `--border` | `#E2D8C7` | Default border |
| `--border-subtle` | `#EFE8DA` | Hairlines, card edges |
| `--text-primary` | `#1B1410` | Espresso black (not pure black) |
| `--text-secondary` | `#5C4D40` | Warm gray-brown |
| `--text-muted` | `#9C8C7B` | Captions, meta |
| `--accent` | `#B5530F` | **Burnt copper** — CTAs, links, brand |
| `--accent-hover` | `#9A4309` | Hover state |
| `--yes` | `#2F7D4F` | Forest green (replaces emerald `#10b981`) |
| `--kinda` | `#C68512` | Amber, warmer than current |
| `--no` | `#A8392F` | Muted brick, less alarming than `#ef4444` |

### Why this works

- **Burnt copper accent (`#B5530F`)** reads as roasted coffee, not as "tech." It is high-contrast on cream, accessible, and visually distinctive in a market saturated with indigo and teal.
- **Cream over white** signals warmth and "café" without resorting to wood-grain textures or coffee-bean illustrations.
- **Espresso black for text (`#1B1410`)** instead of `#000000` reduces visual harshness and matches the warm palette throughout.
- **Forest green over neon emerald** for "yes" signals trust and earned confidence, not a notification.

### Companion palette — Dark mode (toggle, not default)

Keep the dark mode for users who prefer it, but warm it up:

| Token | Hex |
|---|---|
| `--background` | `#1A130E` (espresso) |
| `--surface` | `#26190E` |
| `--surface-2` | `#34241A` |
| `--text-primary` | `#F5EDE0` (cream) |
| `--text-secondary` | `#B8A99A` |
| `--accent` | `#E89561` (warm copper, lighter for dark bg) |

### Action

Replace `src/app/globals.css` `:root` block with the light palette above. The components already consume CSS variables, so no component code changes are required for the base swap.

---

## 3. UI Cleanup

### Homepage (`src/app/page.tsx`)

**What's there:** Sticky bar with logo + tagline + "Submit a spot" → drops straight into `<SpotsDirectory>`.

**Three-second test fixes:**

1. Replace the tagline next to the logo with the **strongest single line:** "Cafés that actually work." (Move the long descriptor "Verified work-friendly cafés & hotel lobbies" to a meta description and the OG card.)
2. Add a **single-row filter pill bar** directly under the top bar: `Open Now · Strong Wi-Fi · Outlets · Quiet · 24hr`. Pre-toggle "Open Now" by default. This is the highest-leverage change for "useful in 3 seconds."
3. Above the grid, render a one-line city header: `New York · 47 verified spots · 12 open now`. Anchors the user, signals breadth.
4. Move the "Submit a spot" link to a quieter ghost button — it's a creator-side action, not a user-side one.

### List view (`SpotCard.tsx`)

The signal grid is already the right idea — it is the single best thing in the current UI. Tighten it:

- **Rename "kinda" → "ok".** "Kinda" reads as uncertainty; "ok" reads as a calibrated verdict. (`SIGNAL_STYLES` line 56.)
- **Cap the signals to 2 chips per card, not 4.** Show the top strength and the worst weakness, e.g., `Wi-Fi: yes` + `Outlets: no`. The 2×2 grid currently doubles as visual noise on a dense page. Move the full grid to the detail page.
- **Replace the "AUTO" pill** with a quieter `unverified` text label in `--text-muted` — the current AUTO badge competes with the verified ✓ for attention.
- **Add relative verification time** under the name: `Verified 3 days ago` in `--text-muted`. Uses existing `last_verified_at`.
- **Lighten the type badge** (currently dark-on-image, top-right) — fine on dark bg, but on the new cream palette use a flat, low-contrast pill instead of a backdrop-blur overlay.

### Detail page (`src/app/spot/[id]/page.tsx`)

The 6 numeric score blocks (Work, Late Night, Wi-Fi, Outlets, Noise, Seating) are too academic. Rework the top of the page so it tells a story in one glance:

1. **Hero photo** — Promote the first photo to a 40vh full-width hero (currently a 260px crop in a 3-up grid). It's the first thing users want to see and it's the easiest scannability win.
2. **Replace the "Scores" grid with a 4-tile verdict bar** — Wi-Fi / Outlets / Quiet / Late, each as a large chip with an icon, a one-word verdict ("Strong" / "Plenty" / "Calm" / "Until 11pm"), and the underlying number small underneath. Keep the 6 underlying scores in an expandable "Score breakdown" section for power users.
3. **Move "Vibe" tags directly under the H1**, not below amenities. Vibe is the second thing users care about after wifi/outlets, and it's currently buried.
4. **Trust block above the fold:** small inline row showing `Verified by Donovan · 4 May 2026 · 23 reviews · 4.6★`. Three independent trust signals beat one big badge.
5. **Reviews — show the most useful first.** Sort by recency × verified-author. Each review's per-attribute star grid (Wi-Fi/Outlets/Late/Seating) is excellent — keep it. Add review text length cap with "Read more."
6. **Photos:** the current 3-up grid is fine. Add a "View all photos" affordance if there are >3.
7. **Sticky bottom action bar on mobile:** "Get Directions" + "Save" — the embedded iframe map is good but a tap-to-navigate is what users actually want.

---

## 4. UX Principles (5)

1. **Three-second clarity** — A user should know if a spot fits within three seconds. Lead with verdicts, not data. Numbers are evidence, not headlines.
2. **Trust through transparency** — Always show what's verified vs. auto-scored, who verified it, and when. Trust is built by being specific about what you don't know.
3. **Scan, don't read** — Color-coded yes / ok / no signals everywhere a user makes a fit/no-fit decision. Reserve prose for nuance, not basics.
4. **Defaults that just work** — Open at the user's city, filter to "Open Now," sort by best work fit. Zero tweaks required to start exploring.
5. **Premium calm** — Warm neutrals, generous whitespace, no decorative animation. The product is about finding a quiet place to work; the UI should feel like one.

---

## 5. Quick Wins — 5 to 10, all under 2 hours

1. **Swap palette in `globals.css`** — replace the `:root` block with the warm-light palette in section 2. ~15 min, transforms the entire feel.
2. **Rename "kinda" → "ok"** in `SpotCard.tsx` `SIGNAL_STYLES`. 1 line, big trust gain.
3. **Tagline rewrite** — replace the sticky-bar copy with "Cafés that actually work." Update `<title>` and meta description in `layout.tsx`.
4. **Pre-applied "Open Now" filter** on the homepage default state. Big perceived-speed win.
5. **Filter pill row** above the directory: Open Now · Wi-Fi · Outlets · Quiet · 24hr. ~45 min.
6. **Add `Verified 3d ago` line** to the SpotCard, replacing or supplementing the AUTO pill. Uses existing `last_verified_at`. ~20 min.
7. **Hero-promote the first photo** on the spot detail page (40vh full-width). ~30 min.
8. **Vibe tags above amenities** on the detail page — 2-line file move.
9. **Replace branded blank-state SVG** — current empty card icon is a generic mountain glyph. Swap for a single coffee-bean lucide icon (`Coffee`) at low opacity. ~10 min.
10. **Add Open Graph metadata + a branded share image** in `layout.tsx`. ~30 min. Massive impact when a spot link gets shared in Slack/iMessage.

---

## 6. Final Polish

### Typography

Pair two Google Fonts, both performant:

- **Body / UI:** [Inter](https://fonts.google.com/specimen/Inter) — variable, geometric, the default for a reason. Use weights 400, 500, 600, 700.
- **Display / wordmark / H1s:** [Fraunces](https://fonts.google.com/specimen/Fraunces) at weight 600, optical-size 36+ — gives the brand a warm, slightly editorial voice (think Substack-meets-Aesop) without sacrificing legibility. If you want to stay leaner, use Inter for everything and reserve `letter-spacing: -0.02em` + weight 700 for the wordmark.

Type scale (px): `11 · 13 · 15 · 17 · 20 · 24 · 32 · 44`. Drop one-off sizes (the codebase currently mixes 10/11/13). Use 13 for body, 11 for meta/captions, 15 for card titles, 24 for H2, 32 for detail-page H1.

### Spacing

Standardize on a 4-px scale: `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64`. The current code is mostly compliant — the visible drift is in card internal padding (`p-3` is tight given the cream palette will need more breathing room; bump to `p-4`).

### Borders & radius

Standardize radius to 3 values: `8` (chips, inputs), `12` (cards), `16` (modal/hero). Current code mixes 8 and 12, which is fine — just lock it.

### Cohesion checklist (final pass before shipping)

- Every interactive hover uses `--accent` — not gray.
- Every "yes" is the same green hex (the codebase currently has emerald `#10b981` hardcoded in 6+ places — replace with `var(--yes)`).
- Verified ✓ badge uses `--accent` (copper), not green. Saves green for the real signals.
- The `pulse-glow` animation on the Open badge: keep it but slow to 3s and dim the glow color — it's currently emerald + bright, which will clash with the calmer palette.
- No two icon sizes within 1px of each other. Current code has 9, 10, 11, 12, 13, 14 — collapse to 12, 14, 16.

---

## Shipping order (suggested)

**Day 1 (4–5h):**
1. Palette swap (globals.css)
2. Replace hardcoded `#10b981` → `var(--yes)` across components
3. SpotCard cleanup: 2-chip signal, "ok" relabel, verified-time line
4. Filter pill row + default Open Now
5. Tagline + OG metadata

**Day 2 (3–4h):**
6. Detail page: hero photo promotion, verdict bar, vibe relocation
7. Typography: Inter (+ optional Fraunces for wordmark)
8. Cohesion sweep — colors, icon sizes, spacing
9. QA on mobile + share-link previews
10. Ship.

— end of brief —
