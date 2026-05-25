'use client'

// ─────────────────────────────────────────────────────────────
// ModePicker — the V2 entry point for /labs.
//
// Renders the 5 primary modes + Other in a responsive grid (2 cols
// on mobile, 3 cols on md+), then a progressive-disclosure "refine"
// section (modifier pills with icons, neighborhood chips, optional
// freeform) once a mode is chosen. Submission calls onSubmit with the
// structured payload; the network round-trip is owned by the parent.
//
// Visual language follows the warm-light palette in globals.css
// (oat-milk surfaces, burnt-copper accent, espresso text). Active
// states use espresso-on-cream inversion — the selected card and
// selected pills read as "locked in," not just highlighted.
//
// Mode and modifier registries come from src/lib/labs/modes.ts — the
// picker iterates Object.values()/an explicit order array, so adding
// or removing a card is a 1-line registry change per ticket #6's
// acceptance criterion.
//
// See:
//   - LABS_V2_PLAN.md §2 (MVP scope), §8 ticket #5
//   - DECISION_LOG.md ADR-0001 + ADR-0005 (mode set + Study amend)
//   - src/lib/labs/modes.ts                 (data registry)
//   - src/components/SpotsDirectory.tsx     (pill pattern reference)
// ─────────────────────────────────────────────────────────────

import { useState } from 'react'
import {
  Laptop,
  BookOpen,
  Notebook,
  Users,
  Briefcase,
  PencilLine,
  Check,
  Moon,
  Headphones,
  Pencil,
  ArrowRight,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { MODES, MODIFIERS, type ModeId, type ModifierId } from '@/lib/labs/modes'
import { POPULAR_NEIGHBORHOODS } from '@/lib/labs/neighborhoods'

// Icon mapping is a UI concern; it lives here, not in modes.ts,
// because modes.ts is data-only (no imports from lucide-react).
// A new mode added to ModeId will fail to compile until it gets an
// entry here — same exhaustive-Record trick as MODES itself.
const MODE_ICON: Record<ModeId, LucideIcon> = {
  deep_work: Laptop,
  study_session: BookOpen,
  creative_reset: Notebook,
  coffee_date: Users,
  client_meeting: Briefcase,
  other: PencilLine,
}

const MODIFIER_ICON: Record<ModifierId, LucideIcon> = {
  open_late: Moon,
  quiet_to_read: Headphones,
}

// Render order, paired by similarity for left/right scan rhythm:
//   Row 1: Deep Work     | Study session     | Creative Reset
//   Row 2: Coffee Date   | Client Meeting    | Other
// On mobile this collapses to a 2-col grid (3 rows). Order is
// decoupled from MODES insertion order so future changes to modes.ts
// don't accidentally reshuffle the grid.
const MODE_ORDER: ModeId[] = [
  'deep_work',
  'study_session',
  'creative_reset',
  'coffee_date',
  'client_meeting',
  'other',
]

/** Location can be a bare string (user typed freeform — we don't
 *  know the city) or an object with both city and neighborhood
 *  (user tapped a chip — city is known from the chip metadata).
 *  The route accepts both shapes; the object form lets the retriever
 *  scope to the right city instead of leaking results from other
 *  cities when the neighborhood matches nothing. */
export type ModePickerLocation = string | { city: string; neighborhood: string }

export interface ModePickerSubmitPayload {
  mode: ModeId
  modifiers: ModifierId[]
  modeFreeform?: string
  location?: ModePickerLocation
}

interface Props {
  onSubmit: (payload: ModePickerSubmitPayload) => void
  submitting?: boolean
}

export function ModePicker({ onSubmit, submitting = false }: Props) {
  const [selectedMode, setSelectedMode] = useState<ModeId | null>(null)
  const [selectedModifiers, setSelectedModifiers] = useState<Set<ModifierId>>(
    () => new Set()
  )
  const [modeFreeform, setModeFreeform] = useState('')
  const [location, setLocation] = useState('')
  // When the user taps a popular-neighborhood chip we capture its
  // inferred city so submit can send { city, neighborhood } and the
  // retriever scopes correctly. Cleared when the user edits the text
  // input directly (we no longer know the city for a freeform value).
  const [locationCity, setLocationCity] = useState<string | null>(null)

  const isOther = selectedMode === 'other'
  // Other requires freeform to be non-empty (the freeform IS the
  // query in that path). Non-Other modes can submit with no extras.
  const submitDisabled =
    submitting || !selectedMode || (isOther && !modeFreeform.trim())

  // Criteria count powers both the Current Search chip and the CTA
  // badge. Counts modifiers + location + freeform — anything the user
  // explicitly added on top of the mode itself.
  const criteriaCount =
    selectedModifiers.size + (location.trim() ? 1 : 0) + (modeFreeform.trim() ? 1 : 0)

  const toggleModifier = (id: ModifierId) => {
    setSelectedModifiers((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clearMode = () => {
    setSelectedMode(null)
    // Modifiers, location, and freeform persist on mode-change so a
    // user who typed something and then re-picked a mode doesn't lose
    // it. Active reset is via clearing the individual inputs.
  }

  const handleSubmit = () => {
    if (submitDisabled || !selectedMode) return
    const trimmedLoc = location.trim()
    // Send the object form when we know both city + neighborhood
    // (chip-driven). Fall back to the bare string when freeform or
    // when chip selection has been edited out of sync.
    const locPayload: ModePickerLocation | undefined = trimmedLoc
      ? locationCity && trimmedLoc.toLowerCase() === locationCity.toLowerCase()
        ? undefined // (shouldn't happen — city != neighborhood)
        : locationCity
          ? { city: locationCity, neighborhood: trimmedLoc }
          : trimmedLoc
      : undefined
    onSubmit({
      mode: selectedMode,
      modifiers: Array.from(selectedModifiers),
      modeFreeform: modeFreeform.trim() || undefined,
      location: locPayload,
    })
  }

  const selectedModeIcon = selectedMode ? MODE_ICON[selectedMode] : null

  return (
    <section className="space-y-12">
      {/* ── Current Search chip ────────────────────────────────
          Persistent espresso-on-cream pill summarizing the active
          search. Tapping it clears the mode (re-opens the picker)
          so the user can switch without scrolling back up. Only
          shows once a mode has been chosen. */}
      {selectedMode && selectedModeIcon && (
        <button
          type="button"
          onClick={clearMode}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left fade-in transition-opacity hover:opacity-90"
          style={{
            backgroundColor: 'var(--text-primary)',
            color: 'var(--background)',
          }}
          aria-label="Edit current search"
        >
          <span
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: 'rgba(250, 247, 242, 0.10)' }}
          >
            {(() => {
              const Icon = selectedModeIcon
              return <Icon size={18} style={{ color: 'var(--background)' }} />
            })()}
          </span>
          <span className="flex-1 min-w-0">
            <span
              className="block text-[10px] uppercase tracking-[0.18em] font-semibold"
              style={{ color: 'rgba(250, 247, 242, 0.55)' }}
            >
              Current Search
            </span>
            <span className="block text-sm font-medium truncate mt-0.5">
              {MODES[selectedMode].label}
              {criteriaCount > 0 && (
                <>
                  <span style={{ color: 'rgba(250, 247, 242, 0.40)' }}>{' · '}</span>
                  {criteriaCount} {criteriaCount === 1 ? 'criterion' : 'criteria'}
                </>
              )}
              {location.trim() && (
                <>
                  <span style={{ color: 'rgba(250, 247, 242, 0.40)' }}>{' · '}</span>
                  {location.trim()}
                </>
              )}
            </span>
          </span>
          <Pencil
            size={16}
            style={{ color: 'rgba(250, 247, 242, 0.55)' }}
            aria-hidden="true"
          />
        </button>
      )}

      {/* ── 01 · Intent ─────────────────────────────────────── */}
      <div className="space-y-6">
        <SectionHeading
          eyebrow="01 · Intent"
          title="What's the plan?"
        />

        <div
          className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4"
          role="radiogroup"
          aria-label="Mode"
        >
          {MODE_ORDER.map((id) => {
            const mode = MODES[id]
            const Icon = MODE_ICON[id]
            const active = selectedMode === id
            const isOtherCard = id === 'other'

            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setSelectedMode(active ? null : id)}
                className="text-left p-4 sm:p-5 rounded-2xl border transition-all relative"
                style={{
                  borderColor: active
                    ? 'var(--text-primary)'
                    : 'var(--border-subtle)',
                  // Dashed border on Other signals "structurally
                  // different" without bumping it to a separate row.
                  // When active, the solid espresso fill is identity
                  // enough — no dashes on active.
                  borderStyle: isOtherCard && !active ? 'dashed' : 'solid',
                  backgroundColor: active
                    ? 'var(--text-primary)'
                    : 'var(--surface)',
                  color: active ? 'var(--background)' : 'var(--text-primary)',
                  minHeight: '152px',
                }}
              >
                {active && (
                  <span
                    className="absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: 'var(--accent)' }}
                    aria-hidden="true"
                  >
                    <Check size={14} color="white" strokeWidth={3} />
                  </span>
                )}
                <span
                  className="inline-flex items-center justify-center w-10 h-10 rounded-lg"
                  style={{
                    backgroundColor: active
                      ? 'rgba(250, 247, 242, 0.10)'
                      : 'var(--surface-2)',
                  }}
                  aria-hidden="true"
                >
                  <Icon
                    size={20}
                    style={{
                      color: active
                        ? 'var(--background)'
                        : 'var(--text-secondary)',
                    }}
                  />
                </span>
                <div
                  className="text-[17px] sm:text-lg font-semibold leading-tight mt-5"
                  style={{ fontFamily: 'var(--font-fraunces)' }}
                >
                  {mode.label}
                </div>
                <div
                  className="text-[12.5px] mt-1.5 leading-snug"
                  style={{
                    color: active
                      ? 'rgba(250, 247, 242, 0.70)'
                      : 'var(--text-muted)',
                  }}
                >
                  {mode.blurb}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── 02 · Refine + 03 · Where ────────────────────────
          Progressive disclosure: nothing below the grid until the
          user has committed to a mode. Reduces cognitive load and
          keeps the initial render uncluttered. */}
      {selectedMode && (
        <div className="space-y-12 fade-in">
          {/* Modifier pills — hidden when Other is selected.
              Rationale (UX): the freeform field already encodes
              constraints in that path, and Hick's Law says reduce
              choices once the user is typing. */}
          {!isOther && (
            <div className="space-y-5">
              <SectionHeading
                eyebrow="02 · Refine"
                title="Anything non-negotiable?"
                helper="These are dealbreakers — we hide cafés that don't meet them."
              />
              <div className="flex flex-wrap gap-2">
                {Object.values(MODIFIERS).map((mod) => {
                  const active = selectedModifiers.has(mod.id)
                  const Icon = MODIFIER_ICON[mod.id]
                  return (
                    <button
                      key={mod.id}
                      type="button"
                      onClick={() => toggleModifier(mod.id)}
                      aria-pressed={active}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium border whitespace-nowrap transition-all"
                      style={
                        active
                          ? {
                              backgroundColor: 'var(--text-primary)',
                              color: 'var(--background)',
                              borderColor: 'var(--text-primary)',
                            }
                          : {
                              backgroundColor: 'var(--surface)',
                              color: 'var(--text-primary)',
                              borderColor: 'var(--border)',
                            }
                      }
                    >
                      <Icon size={15} aria-hidden="true" />
                      {mod.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Where — chip row for fast taps, free-text input behind
              a <datalist> for the long tail. The chip row keeps the
              picker tappable on mobile (no soft keyboard for the
              common case). The text input is still authoritative so
              users can type anything not in the seed list. */}
          <div className="space-y-5">
            <SectionHeading
              eyebrow={isOther ? '02 · Where' : '03 · Where'}
              title="Anywhere in particular?"
              helper="Leave blank if you're open to traveling."
            />

            <div className="flex flex-wrap gap-2">
              {POPULAR_NEIGHBORHOODS.map((n) => {
                const active =
                  location.trim().toLowerCase() === n.value.toLowerCase()
                return (
                  <button
                    key={n.value}
                    type="button"
                    onClick={() => {
                      // Tap-to-fill, tap-again-to-clear. Lets the
                      // user undo a chip without reaching for the
                      // text field.
                      const wasActive =
                        location.trim().toLowerCase() === n.value.toLowerCase()
                      if (wasActive) {
                        setLocation('')
                        setLocationCity(null)
                      } else {
                        setLocation(n.value)
                        setLocationCity(n.city)
                      }
                    }}
                    aria-pressed={active}
                    className="inline-flex items-center px-3.5 py-2 rounded-full text-[13px] font-medium border whitespace-nowrap transition-all"
                    style={
                      active
                        ? {
                            backgroundColor: 'var(--text-primary)',
                            color: 'var(--background)',
                            borderColor: 'var(--text-primary)',
                          }
                        : {
                            backgroundColor: 'var(--surface)',
                            color: 'var(--text-primary)',
                            borderColor: 'var(--border)',
                          }
                    }
                  >
                    {n.label}
                  </button>
                )
              })}
            </div>

            <input
              id="mp-location"
              type="text"
              value={location}
              onChange={(e) => {
                const v = e.target.value
                setLocation(v)
                // If the new value matches a known chip, infer city
                // from the chip; otherwise drop the inferred city
                // (we no longer know which city this neighborhood
                // belongs to).
                const matched = POPULAR_NEIGHBORHOODS.find(
                  (n) => n.value.toLowerCase() === v.trim().toLowerCase()
                )
                setLocationCity(matched?.city ?? null)
              }}
              placeholder="Or type any neighborhood…"
              list="mp-location-suggestions"
              autoComplete="off"
              className="w-full px-4 py-3 text-sm"
            />
            <datalist id="mp-location-suggestions">
              {POPULAR_NEIGHBORHOODS.map((n) => (
                <option key={n.value} value={n.value} />
              ))}
            </datalist>
          </div>

          {/* Freeform — primary input when Other is selected
              (required), optional augment otherwise. For non-Other
              we show a small expandable section to keep the picker
              uncluttered when nothing extra is needed. */}
          {isOther ? (
            <div className="space-y-5">
              <SectionHeading
                eyebrow="03 · Tell us"
                title="What kind of café do you need?"
                helper="Vibe, time of day, must-haves, things to avoid — anything that helps."
              />
              <textarea
                id="mp-freeform"
                value={modeFreeform}
                onChange={(e) => setModeFreeform(e.target.value)}
                placeholder="Describe what you need…"
                rows={4}
                className="w-full px-4 py-3 text-sm resize-none"
              />
            </div>
          ) : (
            <div className="space-y-3">
              <label
                htmlFor="mp-freeform"
                className="block text-[12px] font-medium uppercase tracking-[0.15em]"
                style={{ color: 'var(--text-muted)' }}
              >
                Anything else? <span style={{ textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
              </label>
              <textarea
                id="mp-freeform"
                value={modeFreeform}
                onChange={(e) => setModeFreeform(e.target.value)}
                placeholder={MODES[selectedMode].exampleQuery}
                rows={2}
                className="w-full px-4 py-3 text-sm resize-none"
              />
            </div>
          )}

          {/* Submit — full-width pill, copper fill. Criteria count
              on the right mirrors the bottom-CTA pattern from the
              mockup. */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitDisabled}
            className="w-full flex items-center justify-between gap-3 px-5 py-4 rounded-full text-[15px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              backgroundColor: 'var(--accent)',
              color: 'white',
            }}
          >
            <span
              className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
              style={{ backgroundColor: 'rgba(255, 255, 255, 0.18)' }}
              aria-hidden="true"
            >
              <ArrowRight size={16} strokeWidth={2.5} />
            </span>
            <span className="flex-1 text-center">
              {submitting ? 'Finding cafés…' : 'Find cafés'}
            </span>
            <span
              className="text-[10.5px] uppercase tracking-[0.15em] font-bold"
              style={{ color: 'rgba(255, 255, 255, 0.65)' }}
            >
              {criteriaCount} {criteriaCount === 1 ? 'criterion' : 'criteria'}
            </span>
          </button>
        </div>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// Section heading — small caps copper eyebrow + serif title.
// Used three times in this file (Intent, Refine, Where, Tell us),
// so it earns its own component. Helper text below the title is
// optional and shows in muted tone.
// ─────────────────────────────────────────────────────────────
function SectionHeading({
  eyebrow,
  title,
  helper,
}: {
  eyebrow: string
  title: string
  helper?: string
}) {
  return (
    <div className="space-y-2">
      <div
        className="text-[11px] uppercase tracking-[0.2em] font-semibold"
        style={{ color: 'var(--accent)' }}
      >
        {eyebrow}
      </div>
      <h2
        className="text-[26px] sm:text-3xl tracking-tight"
        style={{
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-fraunces)',
          fontWeight: 600,
          lineHeight: 1.1,
          letterSpacing: '-0.01em',
        }}
      >
        {title}
      </h2>
      {helper && (
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {helper}
        </p>
      )}
    </div>
  )
}
