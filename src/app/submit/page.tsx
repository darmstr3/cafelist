'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MapPin, Send } from 'lucide-react'
import { SpotType } from '@/types'
import { cn } from '@/lib/utils'

interface FormState {
  name: string
  type: SpotType
  address: string
  city: string
  neighborhood: string
  notes: string
  submitted_by: string
  wifi_rating: number
  outlet_rating: number
  noise_rating: number
  seating_rating: number
  late_night_rating: number
}

type SubmitState = 'idle' | 'submitting' | 'success' | 'error'

function RatingSlider({
  label,
  description,
  value,
  onChange,
}: {
  label: string
  description?: string
  value: number
  onChange: (v: number) => void
}) {
  const color =
    value >= 4 ? 'var(--yes)' :
    value >= 3 ? 'var(--kinda)' :
    value >= 2 ? 'var(--kinda)' : 'var(--no)'

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </label>
        <span className="text-xs font-bold" style={{ color }}>
          {value}/5
        </span>
      </div>
      {description && (
        <p className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>{description}</p>
      )}
      <input
        type="range"
        min={1}
        max={5}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, ${color} 0%, ${color} ${(value - 1) * 25}%, var(--surface-3) ${(value - 1) * 25}%, var(--surface-3) 100%)`,
          accentColor: color,
        }}
      />
      <div className="flex justify-between mt-1">
        {['Poor', '', 'OK', '', 'Great'].map((l, i) => (
          <span key={i} className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {l}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function SubmitPage() {
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [form, setForm] = useState<FormState>({
    name: '',
    type: 'coffee_shop',
    address: '',
    city: '',
    neighborhood: '',
    notes: '',
    submitted_by: '',
    wifi_rating: 3,
    outlet_rating: 3,
    noise_rating: 3,
    seating_rating: 3,
    late_night_rating: 3,
  })

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name || !form.address || !form.city) return
    setSubmitState('submitting')

    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        setSubmitState('success')
      } else {
        setSubmitState('error')
      }
    } catch {
      setSubmitState('error')
    }
  }

  if (submitState === 'success') {
    return (
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-20 text-center">
        <div className="text-5xl mb-4">☕</div>
        <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          Spot submitted!
        </h1>
        <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
          Thanks for the contribution. Your spot will appear after review by our team.
        </p>
        <Link
          href="/"
          className="inline-block px-6 py-2.5 rounded-lg text-sm font-semibold"
          style={{ backgroundColor: 'var(--accent)', color: 'white' }}
        >
          Back to directory
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
      {/* Header */}
      <div className="mb-8">
        <div
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium mb-4 border"
          style={{
            backgroundColor: 'rgba(181,83,15,0.1)',
            borderColor: 'rgba(181,83,15,0.2)',
            color: 'var(--accent)',
          }}
        >
          <MapPin size={11} />
          Submit a Spot
        </div>
        <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          Know a great work spot?
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Help others find great places to work. All submissions are reviewed before going live.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info */}
        <div
          className="p-5 rounded-xl border space-y-4"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
        >
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            About the Spot
          </h2>

          <div>
            <label className="block text-xs mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
              Name <span style={{ color: 'var(--no)' }}>*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="e.g. Stumptown Coffee Roasters"
              className="w-full"
              required
            />
          </div>

          <div>
            <label className="block text-xs mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
              Type
            </label>
            <select
              value={form.type}
              onChange={(e) => set({ type: e.target.value as SpotType })}
              className="w-full"
            >
              <option value="coffee_shop">Coffee Shop</option>
              <option value="hotel_lobby">Hotel Lobby</option>
              <option value="diner">Diner</option>
              <option value="bar">Bar</option>
              <option value="library">Library</option>
              <option value="coworking">Coworking Space</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
                City <span style={{ color: 'var(--no)' }}>*</span>
              </label>
              <input
                type="text"
                value={form.city}
                onChange={(e) => set({ city: e.target.value })}
                placeholder="New York City"
                className="w-full"
                required
              />
            </div>
            <div>
              <label className="block text-xs mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
                Neighborhood
              </label>
              <input
                type="text"
                value={form.neighborhood}
                onChange={(e) => set({ neighborhood: e.target.value })}
                placeholder="Lower East Side"
                className="w-full"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
              Address <span style={{ color: 'var(--no)' }}>*</span>
            </label>
            <input
              type="text"
              value={form.address}
              onChange={(e) => set({ address: e.target.value })}
              placeholder="123 Main St, New York, NY 10001"
              className="w-full"
              required
            />
          </div>

          <div>
            <label className="block text-xs mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
              Notes (what makes it great for work?)
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
              placeholder="Describe the vibe, quirks, best times to go, etc."
              rows={4}
              className="w-full resize-none"
            />
          </div>
        </div>

        {/* Ratings */}
        <div
          className="p-5 rounded-xl border space-y-5"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
        >
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            Your Ratings
          </h2>

          <RatingSlider
            label="Wi-Fi Quality"
            description="Speed, reliability, whether a password is needed"
            value={form.wifi_rating}
            onChange={(v) => set({ wifi_rating: v })}
          />
          <RatingSlider
            label="Outlet Availability"
            description="How many outlets, how accessible they are"
            value={form.outlet_rating}
            onChange={(v) => set({ outlet_rating: v })}
          />
          <RatingSlider
            label="Noise Level"
            description="1 = library quiet, 5 = loud bar"
            value={form.noise_rating}
            onChange={(v) => set({ noise_rating: v })}
          />
          <RatingSlider
            label="Seating Comfort"
            description="Chair comfort, table height, space between seats"
            value={form.seating_rating}
            onChange={(v) => set({ seating_rating: v })}
          />
          <RatingSlider
            label="Late Night Suitability"
            description="Is it open late? Is it safe/comfortable at night?"
            value={form.late_night_rating}
            onChange={(v) => set({ late_night_rating: v })}
          />
        </div>

        {/* Submitter */}
        <div
          className="p-5 rounded-xl border"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
        >
          <label className="block text-xs mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
            Your name or email (optional)
          </label>
          <input
            type="text"
            value={form.submitted_by}
            onChange={(e) => set({ submitted_by: e.target.value })}
            placeholder="Anonymous"
            className="w-full"
          />
        </div>

        {submitState === 'error' && (
          <p className="text-sm" style={{ color: 'var(--no)' }}>
            Something went wrong. Please try again.
          </p>
        )}

        <button
          type="submit"
          disabled={submitState === 'submitting' || !form.name || !form.address || !form.city}
          className={cn(
            'w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-opacity',
            submitState === 'submitting' || !form.name || !form.address || !form.city
              ? 'opacity-50 cursor-not-allowed'
              : 'opacity-100'
          )}
          style={{ backgroundColor: 'var(--accent)', color: 'white' }}
        >
          <Send size={15} />
          {submitState === 'submitting' ? 'Submitting…' : 'Submit Spot for Review'}
        </button>
      </form>
    </div>
  )
}
