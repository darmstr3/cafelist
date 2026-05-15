import { NextRequest, NextResponse } from 'next/server'
import { adminUpdateSpot, getSpotById } from '@/lib/spots'
import { Spot } from '@/types'

interface Params {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const spot = await getSpotById(id)
  if (!spot) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ spot })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const body = (await req.json()) as Partial<Spot>

  // adminUpdateSpot enforces a whitelist internally — anything outside
  // the editable field set is silently dropped.
  const ok = await adminUpdateSpot(id, body)
  if (!ok) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

  // Return the fresh row so the client can update its local state without
  // a separate fetch.
  const fresh = await getSpotById(id)
  return NextResponse.json({ success: true, spot: fresh })
}
