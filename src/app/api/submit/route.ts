import { NextRequest, NextResponse } from 'next/server'
import { submitSpot, submitReview } from '@/lib/spots'
import { slugify } from '@/lib/utils'
import { SpotType } from '@/types'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      name,
      type,
      address,
      city,
      neighborhood,
      notes,
      submitted_by,
      wifi_rating,
      outlet_rating,
      noise_rating,
      seating_rating,
      late_night_rating,
    } = body

    if (!name || !address || !city) {
      return NextResponse.json({ error: 'name, address, city are required' }, { status: 400 })
    }

    // Generate a unique slug
    const baseSlug = slugify(`${name}-${city}`)
    const slug = `${baseSlug}-${Date.now().toString(36)}`

    const spot = await submitSpot({
      name,
      slug,
      type: (type as SpotType) ?? 'coffee_shop',
      address,
      city,
      neighborhood: neighborhood || null,
      notes: notes || null,
      submitted_by: submitted_by || null,
      status: 'pending',
    })

    if (!spot) {
      return NextResponse.json({ error: 'Failed to submit spot' }, { status: 500 })
    }

    // Also save the submitter's ratings as a pending review
    if (spot.id && (wifi_rating || outlet_rating || noise_rating || seating_rating || late_night_rating)) {
      await submitReview({
        spot_id: spot.id,
        author_name: submitted_by || 'Submitter',
        wifi_rating: wifi_rating ?? null,
        outlet_rating: outlet_rating ?? null,
        noise_rating: noise_rating ?? null,
        seating_rating: seating_rating ?? null,
        late_night_rating: late_night_rating ?? null,
      })
    }

    return NextResponse.json({ success: true, id: spot.id }, { status: 201 })
  } catch (err) {
    console.error('submit error:', err)
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
