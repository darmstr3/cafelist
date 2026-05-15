# GroundWork ☕

**Find the best cafes to work from in any city — scored 0–100 by wifi, outlets, noise, and hours.**

Data pulled live from Google Maps, Yelp, and Reddit via Apify. Results cached 48 hours per city.

---

## Score breakdown

| Category | Max | How it's calculated |
|----------|-----|---------------------|
| **Wi-Fi** | 30 | Keyword analysis of all reviews: "good wifi", "fast internet" vs "no wifi", "spotty" |
| **Outlets** | 20 | "lots of outlets", "charging available" vs "no outlets", "can't charge" |
| **Noise** | 20 | "quiet", "peaceful", "calm" (up) vs "loud", "noisy", "crowded" (down) |
| **Rating** | 15 | Google + Yelp star rating normalized to 0–15 |
| **Hours** | 15 | Points for opening before 8am, closing after 10pm, open 7 days |

---

## Data sources

- **`apify/google-maps-scraper`** — canonical list of cafes, hours, photos, Google rating, reviews
- **`apify/yelp-scraper`** — additional work-keyword-filtered reviews merged by name matching
- **`apify/reddit-scraper`** — r/digitalnomad, r/remotework, city subreddits for context signals

One `APIFY_API_TOKEN` — that's the only external credential required for data.

---

## Project structure

```
src/
├── app/
│   ├── page.tsx                    # Search-driven homepage (city input → results)
│   └── api/
│       └── search/route.ts         # Cache check → parallel Apify scrape → score → cache
├── components/
│   ├── CitySearch.tsx              # City input + popular city pills
│   ├── CafeCard.tsx                # Card: score badge, signals, hours, breakdown
│   ├── CafeGrid.tsx                # Filterable grid (min score, open now, neighborhood)
│   └── ScoreBreakdown.tsx          # Expandable 5-bar score breakdown + review excerpts
├── lib/
│   ├── apify.ts                    # ApifyClient wrapper (runActor)
│   ├── actors/
│   │   ├── google-maps.ts          # apify/google-maps-scraper input/output types
│   │   ├── yelp.ts                 # apify/yelp-scraper + work-keyword filter
│   │   └── reddit.ts               # apify/reddit-scraper across relevant subreddits
│   ├── scorer.ts                   # 0–100 scoring algorithm with per-category breakdown
│   ├── normalize.ts                # Merge Google + Yelp + Reddit → CafeRecord[]
│   └── cache.ts                    # File cache (./data/) + memory fallback
└── types/
    └── cafe.ts                     # All TypeScript types

data/                               # Auto-created, gitignored — 48hr JSON cache per city
```

---

## Setup

### 1. Get an Apify API token (free tier available)

1. Go to [console.apify.com](https://console.apify.com) → sign up free
2. Go to **Account → Integrations → API tokens** → create a token
3. Free tier gives $5/month credit — enough for ~10 city searches

### 2. Add to `.env.local`

```bash
APIFY_API_TOKEN=apify_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 3. Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), type a city, hit Search.

---

## Deploy to Vercel

```bash
vercel
```

Set `APIFY_API_TOKEN` in your Vercel project's environment variables.

**Important:** Apify scraping runs take 1–5 minutes. Vercel's free plan has a 10-second function timeout. Two options:
- **Vercel Pro** — set `maxDuration = 300` in `vercel.json` (already in the route)
- **Cache-warmup script** — pre-run your top cities on a cron job so users always hit cache

For production at scale, use a background job (e.g. Trigger.dev, Inngest, or a cron that hits `/api/search?city=...` for your top cities every 24hrs).

---

## How the cache works

1. Search request arrives for `"New York City"`
2. Check `data/new-york-city.json` (or `/tmp/groundwork-cache/` on Vercel)
3. If file exists and is < 48 hours old → return immediately (< 50ms)
4. If stale/missing → run all 3 Apify actors in parallel, merge, score, cache, return

Cache lives in `./data/[city-slug].json`. Add `data/` to `.gitignore` to avoid committing scraped data.

---

## Scoring notes

- **Reviews with no text** → scoring falls back to star rating as proxy
- **No Yelp match found** → scored on Google Maps reviews only
- **Reddit** → used for supplementary signal context, not per-cafe matching
- **Noise score** starts at 10/20 (neutral) and moves up/down based on keyword sentiment
