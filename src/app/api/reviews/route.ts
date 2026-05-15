import { NextRequest, NextResponse } from 'next/server'
import { submitReview } from '@/lib/spots'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { spot_id, author_name, wifi_rating, outlet_rating, noise_rating, seating_rating, late_night_rating, comment } = body

    if (!spot_id) {
      return NextResponse.json({ error: 'spot_id is required' }, { status: 400 })
    }

    const ok = await submitReview({
      spot_id,
      author_name: author_name || 'Anonymous',
      wifi_rating: wifi_rating || null,
      outlet_rating: outlet_rating || null,
      noise_rating: noise_rating || null,
      seating_rating: seating_rating || null,
      late_night_rating: late_night_rating || null,
      comment: comment || null,
    })

    if (!ok) return NextResponse.json({ error: 'Failed to submit review' }, { status: 500 })
    return NextResponse.json({ success: true }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
