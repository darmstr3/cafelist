'use client'

/**
 * SpotActions — three buttons on a spot detail page:
 *   ❤ Favorite        — saves to favorites list
 *   ✓ Been here       — marks as tried (records visited_at)
 *   📌 Want to go     — saves to wishlist
 *
 * Anonymous users: clicking any button navigates to /login with a
 * redirect-back path so they return to the same spot after auth.
 *
 * Optimistic UI: button state toggles immediately, rolls back on error.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Heart, Check, Bookmark } from 'lucide-react'

type RelationType = 'favorite' | 'tried' | 'want_to_go'

interface SpotActionsProps {
  spotId: string
  spotSlug: string
  isSignedIn: boolean
  initialState: {
    favorite: boolean
    tried: boolean
    want_to_go: boolean
  }
}

export function SpotActions({ spotId, spotSlug, isSignedIn, initialState }: SpotActionsProps) {
  const router = useRouter()
  const [state, setState] = useState(initialState)
  const [pending, setPending] = useState<RelationType | null>(null)

  async function toggle(type: RelationType) {
    if (!isSignedIn) {
      router.push(`/login?next=/spot/${encodeURIComponent(spotSlug)}`)
      return
    }
    const wasOn = state[type]
    setPending(type)
    setState({ ...state, [type]: !wasOn })

    try {
      const res = await fetch('/api/relations', {
        method: wasOn ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spot_id: spotId, relation_type: type }),
      })
      if (!res.ok) throw new Error('Request failed')
    } catch {
      // Roll back optimistic update.
      setState({ ...state, [type]: wasOn })
    } finally {
      setPending(null)
    }
  }

  const buttons: Array<{
    type: RelationType
    icon: typeof Heart
    label: string
    activeLabel: string
    activeColor: string
  }> = [
    {
      type: 'favorite',
      icon: Heart,
      label: 'Favorite',
      activeLabel: 'Favorited',
      activeColor: 'rgba(208,40,76,1)',
    },
    {
      type: 'tried',
      icon: Check,
      label: 'Been here',
      activeLabel: 'Been here',
      activeColor: 'var(--yes)',
    },
    {
      type: 'want_to_go',
      icon: Bookmark,
      label: 'Want to go',
      activeLabel: 'Saved',
      activeColor: 'var(--accent)',
    },
  ]

  return (
    <div className="flex flex-wrap gap-2 mb-6">
      {buttons.map(({ type, icon: Icon, label, activeLabel, activeColor }) => {
        const active = state[type]
        return (
          <button
            key={type}
            onClick={() => toggle(type)}
            disabled={pending === type}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] font-medium border transition-all hover:opacity-90 disabled:opacity-60"
            style={{
              backgroundColor: active ? activeColor : 'var(--surface)',
              borderColor: active ? activeColor : 'var(--border-subtle)',
              color: active ? 'white' : 'var(--text-secondary)',
            }}
          >
            <Icon
              size={14}
              fill={active && type === 'favorite' ? 'white' : 'none'}
            />
            {active ? activeLabel : label}
          </button>
        )
      })}
    </div>
  )
}
