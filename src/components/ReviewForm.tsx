'use client'

import { useState } from 'react'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ReviewFormProps {
  spotId: string
}

interface StarPickerProps {
  value: number
  onChange: (v: number) => void
  label: string
}

function StarPicker({ value, onChange, label }: StarPickerProps) {
  const [hover, setHover] = useState(0)
  return (
    <div>
      <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{label}</label>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            onClick={() => onChange(i)}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(0)}
            className="transition-transform hover:scale-110"
          >
            <Star
              size={18}
              fill={(hover || value) >= i ? '#F59E0B' : 'none'}
              style={{ color: (hover || value) >= i ? '#F59E0B' : 'var(--border)' }}
            />
          </button>
        ))}
      </div>
    </div>
  )
}

type FormState = 'idle' | 'submitting' | 'success' | 'error'

export function ReviewForm({ spotId }: ReviewFormProps) {
  const [state, setState] = useState<FormState>('idle')
  const [form, setForm] = useState({
    author_name: '',
    wifi_rating: 0,
    outlet_rating: 0,
    noise_rating: 0,
    seating_rating: 0,
    late_night_rating: 0,
    comment: '',
  })

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setState('submitting')

    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, spot_id: spotId }),
      })
      if (res.ok) {
        setState('success')
      } else {
        setState('error')
      }
    } catch {
      setState('error')
    }
  }

  if (state === 'success') {
    return (
      <div
        className="p-4 rounded-xl border text-center"
        style={{ backgroundColor: 'rgba(47,125,79,0.08)', borderColor: 'rgba(47,125,79,0.2)' }}
      >
        <p className="text-sm font-medium" style={{ color: 'var(--yes)' }}>
          Review submitted! It will appear after moderation.
        </p>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="p-4 rounded-xl border space-y-4"
      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
    >
      <div>
        <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Your name</label>
        <input
          type="text"
          value={form.author_name}
          onChange={(e) => set({ author_name: e.target.value })}
          placeholder="Anonymous"
          className="w-full"
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StarPicker label="Wi-Fi" value={form.wifi_rating} onChange={(v) => set({ wifi_rating: v })} />
        <StarPicker label="Outlets" value={form.outlet_rating} onChange={(v) => set({ outlet_rating: v })} />
        <StarPicker label="Noise" value={form.noise_rating} onChange={(v) => set({ noise_rating: v })} />
        <StarPicker label="Seating" value={form.seating_rating} onChange={(v) => set({ seating_rating: v })} />
        <StarPicker label="Late Night" value={form.late_night_rating} onChange={(v) => set({ late_night_rating: v })} />
      </div>

      <div>
        <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Comment (optional)</label>
        <textarea
          value={form.comment}
          onChange={(e) => set({ comment: e.target.value })}
          placeholder="Anything worth knowing about this spot…"
          rows={3}
          className="w-full resize-none"
        />
      </div>

      {state === 'error' && (
        <p className="text-xs" style={{ color: 'var(--no)' }}>
          Something went wrong. Please try again.
        </p>
      )}

      <button
        type="submit"
        disabled={state === 'submitting'}
        className={cn(
          'w-full py-2.5 rounded-lg text-sm font-semibold transition-opacity',
          state === 'submitting' ? 'opacity-60 cursor-not-allowed' : ''
        )}
        style={{ backgroundColor: 'var(--accent)', color: 'white' }}
      >
        {state === 'submitting' ? 'Submitting…' : 'Submit Review'}
      </button>
    </form>
  )
}
