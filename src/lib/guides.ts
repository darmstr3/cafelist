import { Spot } from '@/types'
import { getSpots } from './spots'

/**
 * Programmatic SEO landing pages — deliberately a short, explicit list
 * (not a combinatorial generator) so we don't create thin/duplicate pages.
 * Each entry is backed by real, verifiably-nonzero result counts against
 * live production data (checked 2026-10-31):
 *   - astoria-laptop-friendly: 19 approved Astoria spots, all laptop_friendly=true
 *   - late-night-study-nyc: 37 approved spots close at/after 9pm or past
 *     midnight on at least one day
 *   - brooklyn-wifi-outlets: 7 approved spots in a Brooklyn neighborhood
 *     with both has_wifi and has_outlets true
 * If a future edit makes any of these filters return 0 results, the page
 * should be pulled rather than shipped empty — see `minExpectedResults`.
 */

export type GuideSlug = 'astoria-laptop-friendly' | 'late-night-study-nyc' | 'brooklyn-wifi-outlets'

export interface GuideDef {
  slug: GuideSlug
  navLabel: string
  title: string
  h1: string
  description: string
  intro: string
  /** Lower bound we expect live data to clear; a sanity check, not a cap. */
  minExpectedResults: number
  filter: (spots: Spot[]) => Spot[]
}

// Brooklyn micro-neighborhoods actually present in live data (queried
// 2026-10-31) — there is no `borough` column, so this is a maintained
// mapping, not a guess. Update if new Brooklyn neighborhoods get added.
const BROOKLYN_NEIGHBORHOODS = new Set([
  'greenpoint', 'bushwick', 'williamsburg', 'park slope',
  'bedford-stuyvesant', 'dumbo', 'fort greene', 'boerum hill',
  'cobble hill', 'carroll gardens', 'red hook', 'sunset park',
  'bay ridge', 'brooklyn heights', 'downtown brooklyn', 'gowanus',
  'crown heights', 'prospect heights', 'clinton hill', 'east williamsburg',
])

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

/** Day-agnostic "closes late on at least one day" check — unlike
 * isOpenLate()/isOpenAfterMidnight() in lib/utils.ts, this does NOT key off
 * today's weekday. A static landing page can't honestly vary by the day
 * Googlebot happens to crawl it. */
function closesLateAnyDay(hours: Spot['hours']): boolean {
  if (!hours) return false
  for (const day of Object.values(hours)) {
    if (!day?.close) continue
    const closeMin = timeToMinutes(day.close)
    if (closeMin === 0 || closeMin >= 21 * 60 || closeMin < 6 * 60) return true
  }
  return false
}

export const GUIDES: GuideDef[] = [
  {
    slug: 'astoria-laptop-friendly',
    navLabel: 'Astoria',
    title: 'Laptop-Friendly Cafés in Astoria, NYC | Cafelist',
    h1: 'Laptop-friendly cafés in Astoria',
    description:
      'Real laptop-friendly cafés in Astoria, Queens — Wi-Fi, outlets, and noise level from Cafelist, not aggregated review-site guesses.',
    intro:
      'Every café below is marked laptop_friendly in our own data, not inferred from star ratings. Where outlet or Wi-Fi data isn’t independently verified, we say so on the card rather than presenting a guess as fact.',
    minExpectedResults: 10,
    filter: (spots) => spots.filter((s) => s.neighborhood === 'Astoria' && s.laptop_friendly),
  },
  {
    slug: 'late-night-study-nyc',
    navLabel: 'Late-night study',
    title: 'NYC Cafés Open Late for Studying | Cafelist',
    h1: 'NYC cafés open late for studying',
    description:
      'NYC cafés that stay open into the evening or overnight — real hours from Cafelist, for late-night studying or working.',
    intro:
      'These cafés close at 9pm or later (or run overnight) on at least one day, based on the hours we have on file. Hours can change seasonally or around holidays — check the venue page for the full weekly schedule before a long trip across town.',
    minExpectedResults: 15,
    filter: (spots) => spots.filter((s) => closesLateAnyDay(s.hours)),
  },
  {
    slug: 'brooklyn-wifi-outlets',
    navLabel: 'Brooklyn',
    title: 'Brooklyn Cafés with Wi-Fi and Outlets | Cafelist',
    h1: 'Brooklyn cafés with Wi-Fi and outlets',
    description:
      'Brooklyn cafés confirmed to have both Wi-Fi and power outlets — real data from Cafelist across Williamsburg, Greenpoint, Park Slope, Bushwick, and more.',
    intro:
      'Filtered to Cafelist’s Brooklyn neighborhoods (Williamsburg, Greenpoint, Park Slope, Bushwick, Bed-Stuy, DUMBO, Fort Greene, Boerum Hill, and a few others) where both Wi-Fi and outlets are marked present. This is a shorter, higher-confidence list by design — see the full directory for more Brooklyn spots with partial amenity data.',
    minExpectedResults: 5,
    filter: (spots) =>
      spots.filter(
        (s) =>
          !!s.neighborhood &&
          BROOKLYN_NEIGHBORHOODS.has(s.neighborhood.toLowerCase()) &&
          s.has_wifi &&
          s.has_outlets
      ),
  },
]

export function getGuide(slug: string): GuideDef | undefined {
  return GUIDES.find((g) => g.slug === slug)
}

export async function getGuideSpots(guide: GuideDef): Promise<{ spots: Spot[]; serviceError: boolean }> {
  const { spots, serviceError } = await getSpots()
  if (serviceError) return { spots: [], serviceError: true }
  return { spots: guide.filter(spots), serviceError: false }
}
