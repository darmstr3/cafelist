import { NextRequest, NextResponse } from 'next/server'
import { getSpots } from '@/lib/spots'
import { SpotFilters } from '@/types'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl

  const filters: Partial<SpotFilters> = {
    search: searchParams.get('search') ?? '',
    city: searchParams.get('city') ?? '',
    type: (searchParams.get('type') as SpotFilters['type']) ?? '',
    openNow: searchParams.get('openNow') === 'true',
    openLate: searchParams.get('openLate') === 'true',
    openAfterMidnight: searchParams.get('openAfterMidnight') === 'true',
    hasWifi: searchParams.get('hasWifi') === 'true',
    hasOutlets: searchParams.get('hasOutlets') === 'true',
    laptopFriendly: searchParams.get('laptopFriendly') === 'true',
  }

  const { spots, serviceError } = await getSpots(filters)
  if (serviceError) {
    return NextResponse.json(
      { spots: [], total: 0, error: 'Service temporarily unavailable' },
      { status: 503 }
    )
  }
  return NextResponse.json({ spots, total: spots.length })
}
