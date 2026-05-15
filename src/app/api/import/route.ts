import { NextRequest, NextResponse } from 'next/server'
import {
  textSearch,
  getPlaceDetails,
  convertHours,
  mapPlaceType,
  scoreFromReviews,
  noiseLevelFromText,
  seatingComfortFromData,
  vibeTagsFromPlace,
  photoUrlRedirect,
  GPPlace,
} from '@/lib/google-places'
import { supabaseAdmin } from '@/lib/supabase'

// ── Helpers ───────────────────────────────────────────────────

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim()
}

function extractNeighborhood(address: string): string | null {
  const neighborhoods = [
    'Greenwich Village', 'East Village', 'West Village', 'SoHo', 'Tribeca',
    'Lower East Side', 'Chinatown', 'Flatiron', 'Chelsea', 'Midtown',
    'Hell\'s Kitchen', 'Upper West Side', 'Upper East Side', 'Harlem',
    'Washington Heights', 'Financial District', 'Gramercy', 'Murray Hill',
    'Williamsburg', 'Bushwick', 'Greenpoint', 'Park Slope', 'DUMBO',
    'Crown Heights', 'Bed-Stuy', 'Brooklyn Heights', 'Astoria', 'Long Island City',
  ]
  for (const n of neighborhoods) {
    if (address.toLowerCase().includes(n.toLowerCase())) return n
  }
  return null
}

function placeToRow(place: GPPlace) {
  const reviews = place.reviews ?? []
  const allReviewText = reviews.map((r) => r.text?.text ?? '').join(' ')
  const reviewLower = allReviewText.toLowerCase()

  const scores = scoreFromReviews(reviews, place)
  const hours = convertHours(place.regularOpeningHours)
  const type = mapPlaceType(place.types ?? [])
  const name = place.displayName?.text ?? 'Unknown'
  const address = place.formattedAddress ?? ''

  return {
    name,
    slug: `${slugify(name)}-nyc-${place.id.slice(-6)}`,
    type,
    address,
    city: 'New York City',
    neighborhood: extractNeighborhood(address),
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    google_place_id: place.id,
    photos: (place.photos ?? []).slice(0, 4).map((p, i) => ({
      url: photoUrlRedirect(p.name, 800),
      caption: i === 0 ? 'Main' : `Photo ${i + 1}`,
    })),
    hours,
    ...scores,
    has_wifi: reviewLower.includes('wifi') || reviewLower.includes('wi-fi') || type === 'coffee_shop',
    has_outlets: reviewLower.includes('outlet') || reviewLower.includes('charging'),
    laptop_friendly: scores.work_score >= 5.5,
    has_bathroom: type !== 'other',
    has_food: type === 'diner' || type === 'bar' || reviewLower.includes('food'),
    has_drinks: type !== 'library',
    noise_level: noiseLevelFromText(allReviewText),
    seating_comfort: seatingComfortFromData(reviews, place.priceLevel),
    vibe_tags: vibeTagsFromPlace(place, reviews),
    notes: place.editorialSummary?.text ?? reviews[0]?.text?.text?.slice(0, 280) ?? '',
    status: 'approved',
  }
}

// ── NYC Search Queries ─────────────────────────────────────────

const NYC_QUERIES = [
  '24 hour coffee shop New York City',
  'open all night cafe Manhattan',
  'coffee shop laptop friendly Manhattan',
  'coffee shop open late Brooklyn',
  'cafe wifi New York City',
  'late night diner Manhattan',
  '24 hour diner New York',
  'hotel lobby work friendly New York',
  'coffee shop open late Williamsburg',
  'cafe East Village New York laptop',
  'coffee shop SoHo New York',
  'cafe Chelsea Manhattan',
  'coffee shop open late Astoria Queens',
]

const NYC_CENTER = { lat: 40.7128, lng: -74.0060 }

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Route ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const googleKey = process.env.GOOGLE_PLACES_API_KEY ?? ''

  if (!googleKey || googleKey.includes('placeholder')) {
    return NextResponse.json(
      { error: 'GOOGLE_PLACES_API_KEY is not configured in .env.local' },
      { status: 400 }
    )
  }

  const body = await req.json().catch(() => ({}))
  const limit = body.limit ?? 60
  const queries: string[] = body.queries ?? NYC_QUERIES

  const seenIds = new Set<string>()
  const toFetch: GPPlace[] = []

  // Step 1: collect place IDs
  for (const query of queries) {
    if (toFetch.length >= limit) break
    try {
      const results = await textSearch(query, {
        lat: NYC_CENTER.lat,
        lng: NYC_CENTER.lng,
        radiusMeters: 35000,
        maxResults: 20,
      })
      for (const p of results) {
        if (!seenIds.has(p.id) && toFetch.length < limit) {
          seenIds.add(p.id)
          toFetch.push(p)
        }
      }
    } catch (err) {
      console.error('textSearch error:', err)
    }
    await sleep(150)
  }

  // Step 2: fetch details + reviews
  const rows = []
  for (const place of toFetch) {
    try {
      const details = await getPlaceDetails(place.id)
      rows.push(placeToRow(details))
    } catch (err) {
      console.error(`Details error for ${place.id}:`, err)
    }
    await sleep(200)
  }

  // Step 3: upsert
  const { data, error } = await supabaseAdmin
    .from('spots')
    .upsert(rows, { onConflict: 'google_place_id', ignoreDuplicates: false })
    .select('id, name')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    searched: queries.length,
    found: toFetch.length,
    upserted: data?.length ?? 0,
    spots: data,
  })
}
