'use client'

// ─────────────────────────────────────────────────────────────
// ModePicker — the V2 entry point for /labs.
//
// Renders the 5 primary modes + Other in a 2-column grid, then a
// progressive-disclosure "refine" section (modifier pills, optional
// neighborhood, optional freeform) once a mode is chosen. Submission
// calls onSubmit with the structured payload; the network round-trip
// is owned by the parent (LabsV2Experience).
//
// Visual language follows the warm-light palette in globals.css
// (oat-milk surfaces, burnt-copper accent, espresso text) so the
// V2 surface feels like one product with the homepage. Pill styling
// mirrors SpotsDirectory's quick-filter pattern for the same reason.
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
  ArrowRight,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { MODES, MODIFIERS, type ModeId, type ModifierId } from '@/lib/labs/modes'

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

// Render order, paired by similarity for left/right scan rhythm:
//   Row 1: Deep Work     | Study session     (focused work)
//   Row 2: Creative Reset| Coffee Date       (lighter)
//   Row 3: Client Meeting| Other             (professional + escape hatch)
// Order is decoupled from MODES insertion order so future changes
// to modes.ts don't accidentally reshuffle the grid.
const MODE_ORDER: ModeId[] = [
  'deep_work',
  'study_session',
  'creative_reset',
  'coffee_date',
  'client_meeting',
  'other',
]

export interface ModePickerSubmitPayload {
  mode: ModeId
  modifiers: ModifierId[]
  modeFreeform?: string
  location?: string
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

  const isOther = selectedMode === 'other'
  // Other requires freeform to be non-empty (the freeform IS the
  // query in that path). Non-Other modes can submit with no extras.
  const submitDisabled =
    submitting || !selectedMode || (isOther && !modeFreeform.trim())

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
    // Modifiers and freeform persist on mode-change so a user who
    // typed something and then re-picked a mode doesn't lose it.
    // If a user actively wants to reset, they can clear the inputs.
  }

  const handleSubmit = () => {
    if (submitDisabled || !selectedMode) return
    onSubmit({
      mode: selectedMode,
      modifiers: Array.from(selectedModifiers),
      modeFreeform: modeFreeform.trim() || undefined,
      location: location.trim() || undefined,
    })
  }

  return (
    <section className="space-y-6">
      {/* ── Heading ────────────────────────────────────────── */}
      <header className="space-y-2">
        <h1
          className="text-2xl sm:text-3xl font-semibold tracking-tight"
          style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-fraunces)' }}
        >
          What are you trying to do?
        </h1>
        <p
          className="text-sm leading-relaxed"
          style={{ color: 'var(--text-secondary)' }}
        >
          Pick a mode. We&apos;ll match cafés to it.
        </p>
      </header>

      {/* ── Mode grid ──────────────────────────────────────── */}
      <div
        className="grid grid-cols-2 gap-3"
        role="radiogroup"
        aria-label="Mode"
      >
        {MODE_ORDER.map((id) => {
          const mode = MODES[id]
          const Icon = MODE_ICON[id]
          const active = selectedMode === id
          // Dim non-active cards once a selection has been made so
          // the eye stays on the choice. Dimming, not hiding, keeps
          // "tap a different card to switch" discoverable.
          const dimmed = selectedMode !== null && !active
          const isOtherCard = id === 'other'

          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setSelectedMode(active ? null : id)}
              className="text-left p-4 rounded-2xl border-2 transition-all relative"
              style={{
                borderColor: active ? 'var(--accent)' : 'var(--border-subtle)',
                // Dashed border on Other signals "structurally different"
                // without bumping it to a separate row.
                borderStyle: isOtherCard ? 'dashed' : 'solid',
                backgroundColor: active ? 'var(--accent-glow)' : 'var(--surface)',
                opacity: dimmed ? 0.55 : 1,
                minHeight: '124px',
              }}
            >
              {active && (
                <span
                  className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: 'var(--accent)' }}
                  aria-hidden="true"
                >
                  <Check size={12} color="white" strokeWidth={3} />
                </span>
              )}
              <Icon
                size={20}
                style={{
                  color: active ? 'var(--accent)' : 'var(--text-secondary)',
                }}
                aria-hidden="true"
              />
              <div
                className="text-[14px] font-semibold mt-2"
                style={{ color: 'var(--text-primary)' }}
              >
                {mode.label}
              </div>
              <div
                className="text-[12px] mt-1 leading-snug"
                style={{ color: 'var(--text-muted)' }}
              >
                {mode.blurb}
              </div>
            </button>
          )
        })}
      </div>

      {/* ── Refine + inputs ────────────────────────────────── */}
      {/* Progressive disclosure: nothing below the grid until the
          user has committed to a mode. Reduces cognitive load and
          keeps the initial render uncluttered. */}
      {selectedMode && (
        <div className="space-y-5 fade-in">
          {/* Selected anchor — reminds the user what they picked
              once the grid scrolls above the fold on mobile. */}
          <div
            className="flex items-center justify-between text-xs pb-2 border-b"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <span style={{ color: 'var(--text-muted)' }}>
              Selected:{' '}
              <span
                className="font-semibold"
                style={{ color: 'var(--accent)' }}
              >
                {MODES[selectedMode].label}
              </span>
            </span>
            <button
              type="button"
              onClick={clearMode}
              className="underline transition-opacity hover:opacity-70"
              style={{ color: 'var(--text-secondary)' }}
            >
              change
            </button>
          </div>

          {/* Modifier pills — hidden when Other is selected.
              Rationale (UX): the freeform field already encodes
              constraints in that path, and Hick's Law says reduce
              choices once the user is typing. */}
          {!isOther && (
            <div>
              <div
                className="text-[10px] uppercase tracking-wider mb-2 font-semibold"
                style={{ color: 'var(--text-muted)' }}
              >
                Refine
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.values(MODIFIERS).map((mod) => {
                  const active = selectedModifiers.has(mod.id)
                  return (
                    <button
                      key={mod.id}
                      type="button"
                      onClick={() => toggleModifier(mod.id)}
                      aria-pressed={active}
                      className="px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap transition-all"
                      style={
                        active
                          ? {
                              backgroundColor: 'var(--accent)',
                              color: 'white',
                              borderColor: 'var(--accent)',
                            }
                          : {
                              backgroundColor: 'var(--surface-2)',
                              color: 'var(--text-secondary)',
                              borderColor: 'var(--border)',
                            }
                      }
                    >
                      {mod.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Neighborhood — always optional. Free text for now;
              "near me" / geolocation hook is ticket #4 scope per
              LABS_V2_PLAN.md §2.4 and lives in the parent. */}
          <div>
            <label
              htmlFor="mp-location"
              className="block text-xs font-medium mb-1.5"
              style={{ color: 'var(--text-secondary)' }}
            >
              Neighborhood{' '}
              <span style={{ color: 'var(--text-muted)' }}>(optional)</span>
            </label>
            <input
              id="mp-location"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder='e.g. East Village, or "near me"'
              className="w-full px-3 py-2.5 text-sm"
            />
          </div>

          {/* Freeform — promoted to primary input + required when
              Other is selected; demoted to optional augment otherwise.
              Placeholder reuses the mode's exampleQuery so the user
              sees a concrete example of the kind of detail that helps. */}
          <div>
            <label
              htmlFor="mp-freeform"
              className="block text-xs font-medium mb-1.5"
              style={{ color: 'var(--text-secondary)' }}
            >
              {isOther ? (
                <>Tell us what you need</>
              ) : (
                <>
                  Anything else?{' '}
                  <span style={{ color: 'var(--text-muted)' }}>(optional)</span>
                </>
              )}
            </label>
            <textarea
              id="mp-freeform"
              value={modeFreeform}
              onChange={(e) => setModeFreeform(e.target.value)}
              placeholder={
                isOther
                  ? 'Describe what kind of café you need…'
                  : MODES[selectedMode].exampleQuery
              }
              rows={isOther ? 4 : 2}
              className="w-full px-3 py-2.5 text-sm resize-none"
            />
          </div>

          {/* Submit */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitDisabled}
            className="w-full px-4 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              backgroundColor: 'var(--accent)',
              color: 'white',
            }}
          >
            {submitting ? (
              'Finding cafés…'
            ) : (
              <>
                Find cafés
                <ArrowRight size={15} aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      )}
    </section>
  )
}
