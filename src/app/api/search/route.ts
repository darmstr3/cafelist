import { NextResponse } from 'next/server'

// ─────────────────────────────────────────────────────────────
// DEPRECATED — Phase 1 cleanup.
// Live "scrape any city on demand" is gone. The app now reads
// approved spots directly from Supabase via getSpots() in
// src/lib/spots.ts. This route is kept only to return a clean
// 410 in case anything still calls /api/search.
// Safe to delete src/app/api/search/ via Finder.
// ─────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      error:
        'On-demand city search has been removed. Spots are now seeded via `npm run import:nyc` and served from Supabase at /api/spots.',
    },
    { status: 410 }
  )
}

export async function DELETE(): Promise<NextResponse> {
  return NextResponse.json({ error: 'Endpoint removed.' }, { status: 410 })
}
