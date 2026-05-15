'use client'

import { useState } from 'react'
import { Spot, NoiseLevel, SeatingComfort } from '@/types'
import { Save, X, Loader2 } from 'lucide-react'

interface SpotEditPanelProps {
  spot: Spot
  onSaved: (updated: Spot) => void
  onCancel: () => void
}

const NOISE_LEVELS: NoiseLevel[] = ['silent', 'quiet', 'moderate', 'loud']
const SEATING_COMFORTS: SeatingComfort[] = ['poor', 'fair', 'good', 'excellent']

const BOOLEAN_FIELDS: Array<{ key: keyof Spot; label: string }> = [
  { key: 'has_wifi', label: 'Wi-Fi' },
  { key: 'has_outlets', label: 'Outlets' },
  { key: 'laptop_friendly', label: 'Laptop-friendly' },
  { key: 'has_bathroom', label: 'Bathroom' },
  { key: 'has_food', label: 'Food' },
  { key: 'has_drinks', label: 'Drinks (incl. alcohol)' },
]

const SCORE_FIELDS: Array<{ key: keyof Spot; label: string }> = [
  { key: 'work_score', label: 'Work' },
  { key: 'late_night_score', label: 'Late night' },
  { key: 'wifi_score', label: 'Wi-Fi' },
  { key: 'outlet_score', label: 'Outlets' },
  { key: 'noise_score', label: 'Noise' },
  { key: 'seating_score', label: 'Seating' },
]

export function SpotEditPanel({ spot, onSaved, onCancel }: SpotEditPanelProps) {
  const [draft, setDraft] = useState<Partial<Spot>>(() => ({
    neighborhood: spot.neighborhood,
    noise_level: spot.noise_level,
    seating_comfort: spot.seating_comfort,
    has_wifi: spot.has_wifi,
    has_outlets: spot.has_outlets,
    laptop_friendly: spot.laptop_friendly,
    has_bathroom: spot.has_bathroom,
    has_food: spot.has_food,
    has_drinks: spot.has_drinks,
    work_score: spot.work_score,
    late_night_score: spot.late_night_score,
    wifi_score: spot.wifi_score,
    outlet_score: spot.outlet_score,
    noise_score: spot.noise_score,
    seating_score: spot.seating_score,
    vibe_tags: spot.vibe_tags,
    notes: spot.notes,
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof Spot>(key: K, value: Spot[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/spots/${spot.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Save failed')
        setSaving(false)
        return
      }
      onSaved(data.spot ?? { ...spot, ...draft })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
      setSaving(false)
    }
  }

  return (
    <div
      className="mt-3 p-4 rounded-xl border space-y-4"
      style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--accent)' }}
    >
      {/* ── Neighborhood ── */}
      <Field label="Neighborhood">
        <input
          type="text"
          value={draft.neighborhood ?? ''}
          onChange={(e) => set('neighborhood', e.target.value || null)}
          placeholder="e.g. SoHo, Williamsburg"
          className="w-full px-3 py-2 rounded-lg text-sm border"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: 'var(--border)',
            color: 'var(--text-primary)',
          }}
        />
      </Field>

      {/* ── Boolean toggles (the "I went there and they DO have outlets" fix) ── */}
      <Field label="Amenities">
        <div className="grid grid-cols-2 gap-2">
          {BOOLEAN_FIELDS.map(({ key, label }) => {
            const value = draft[key] as boolean
            return (
              <button
                key={key}
                type="button"
                onClick={() => set(key, !value as never)}
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all text-left"
                style={
                  value
                    ? {
                        backgroundColor: 'rgba(47,125,79,0.12)',
                        borderColor: 'rgba(47,125,79,0.4)',
                        color: 'var(--yes)',
                      }
                    : {
                        backgroundColor: 'var(--surface)',
                        borderColor: 'var(--border)',
                        color: 'var(--text-muted)',
                      }
                }
              >
                <span
                  className="w-4 h-4 rounded border-2 flex items-center justify-center shrink-0"
                  style={{
                    borderColor: value ? 'var(--yes)' : 'var(--border)',
                    backgroundColor: value ? 'var(--yes)' : 'transparent',
                  }}
                >
                  {value && <span className="text-white text-[10px] leading-none">✓</span>}
                </span>
                {label}
              </button>
            )
          })}
        </div>
      </Field>

      {/* ── Noise level + seating comfort ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Noise level">
          <select
            value={draft.noise_level ?? ''}
            onChange={(e) => set('noise_level', (e.target.value || null) as NoiseLevel | null)}
            className="w-full px-3 py-2 rounded-lg text-sm border capitalize"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--text-primary)',
            }}
          >
            <option value="">(unknown)</option>
            {NOISE_LEVELS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </Field>

        <Field label="Seating comfort">
          <select
            value={draft.seating_comfort ?? ''}
            onChange={(e) => set('seating_comfort', (e.target.value || null) as SeatingComfort | null)}
            className="w-full px-3 py-2 rounded-lg text-sm border capitalize"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--text-primary)',
            }}
          >
            <option value="">(unknown)</option>
            {SEATING_COMFORTS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>

      {/* ── Scores ── */}
      <Field label="Scores (0–10, 1 decimal)">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {SCORE_FIELDS.map(({ key, label }) => (
            <div key={key} className="flex flex-col gap-1">
              <label className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{label}</label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="10"
                value={(draft[key] as number) ?? 0}
                onChange={(e) => set(key, Number(e.target.value) as never)}
                className="px-2 py-1.5 rounded-lg text-sm border w-full"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>
          ))}
        </div>
      </Field>

      {/* ── Vibe tags ── */}
      <Field label="Vibe tags (comma-separated)">
        <input
          type="text"
          value={(draft.vibe_tags ?? []).join(', ')}
          onChange={(e) =>
            set(
              'vibe_tags',
              e.target.value
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean)
            )
          }
          placeholder="cozy, hidden gem, late night"
          className="w-full px-3 py-2 rounded-lg text-sm border"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: 'var(--border)',
            color: 'var(--text-primary)',
          }}
        />
      </Field>

      {/* ── Notes (replaces Google review snippet with curator's note) ── */}
      <Field label="Visit notes">
        <textarea
          value={draft.notes ?? ''}
          onChange={(e) => set('notes', e.target.value)}
          rows={3}
          placeholder="What you actually saw — outlet locations, peak times, weird policies, who'd love this place"
          className="w-full px-3 py-2 rounded-lg text-sm border resize-none"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: 'var(--border)',
            color: 'var(--text-primary)',
          }}
        />
      </Field>

      {/* ── Error ── */}
      {error && (
        <div
          className="text-xs p-2 rounded-lg"
          style={{ backgroundColor: 'rgba(168,57,47,0.1)', color: 'var(--no)' }}
        >
          {error}
        </div>
      )}

      {/* ── Actions ── */}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: 'white' }}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: 'var(--border)',
            color: 'var(--text-secondary)',
          }}
        >
          <X size={14} />
          Cancel
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        {label}
      </label>
      {children}
    </div>
  )
}
