import Link from 'next/link'
import { Spot } from '@/types'
import { SpotCardImage } from './SpotCardImage'
import {
  cn,
  isOpenNow,
  formatHoursDisplay,
  typeLabel,
  is24Hours,
  isOpenAfter9pm,
  isOpenAfterMidnight,
} from '@/lib/utils'

interface SpotCardProps {
  spot: Spot
  className?: string
}

// ── Positive-only signals ────────────────────────────────────
// Previous version showed "WIFI: no / OUTLETS: no / LATE: no" on every
// spot where data was defaulted/missing, which read as accusations
// rather than "we don't know". And labels like "Late" were cryptic
// (friend feedback: "wtf does late mean").
//
// New rule: only surface a chip when we have positive evidence it
// applies. No fabricated negatives. Use clear plain-English labels.

interface PositiveChip {
  label: string
  tone: 'strong' | 'soft'
}

function positiveChipsForSpot(spot: Spot): PositiveChip[] {
  const chips: PositiveChip[] = []
  if (spot.has_wifi && spot.wifi_score >= 4) {
    chips.push({ label: 'Wi-Fi', tone: spot.wifi_score >= 6.5 ? 'strong' : 'soft' })
  }
  if (spot.has_outlets && spot.outlet_score >= 4) {
    chips.push({ label: 'Outlets', tone: spot.outlet_score >= 6.5 ? 'strong' : 'soft' })
  } else if (spot.has_outlets) {
    chips.push({ label: 'Outlets', tone: 'soft' })
  }
  if (spot.noise_level === 'silent' || spot.noise_level === 'quiet') {
    chips.push({ label: 'Quiet', tone: 'strong' })
  }
  if (is24Hours(spot.hours) || isOpenAfterMidnight(spot.hours)) {
    chips.push({ label: 'Open late', tone: 'strong' })
  } else if (isOpenAfter9pm(spot.hours)) {
    chips.push({ label: 'Open till 9pm+', tone: 'soft' })
  }
  return chips.slice(0, 3) // cap to keep the card tidy
}

function workabilityChip(spot: Spot): { score: string; tone: 'great' | 'good' | 'ok' } | null {
  if (spot.workability_score == null) return null
  const s = Number(spot.workability_score)
  const score = s.toFixed(1)
  if (s >= 8) return { score, tone: 'great' }
  if (s >= 6) return { score, tone: 'good' }
  if (s >= 4) return { score, tone: 'ok' }
  return null // hide low scores — no need to advertise a 2.5
}

const CHIP_TONE_STYLES: Record<PositiveChip['tone'], { bg: string; color: string }> = {
  strong: { bg: 'rgba(47,125,79,0.14)', color: 'var(--yes)' },
  soft:   { bg: 'rgba(47,125,79,0.06)', color: 'var(--yes)' },
}

const WORKABILITY_TONE_STYLES: Record<'great' | 'good' | 'ok', { bg: string; color: string; label: string }> = {
  great: { bg: 'rgba(47,125,79,0.18)', color: 'var(--yes)',   label: 'great' },
  good:  { bg: 'rgba(47,125,79,0.12)', color: 'var(--yes)',   label: 'good' },
  ok:    { bg: 'rgba(198,133,18,0.12)', color: 'var(--kinda)', label: 'ok' },
}

function PositiveChipBadge({ chip }: { chip: PositiveChip }) {
  const s = CHIP_TONE_STYLES[chip.tone]
  return (
    <span
      className="px-1.5 py-0.5 rounded-md text-[9px] sm:text-[10px] font-semibold whitespace-nowrap"
      style={{ backgroundColor: s.bg, color: s.color }}
    >
      {chip.label}
    </span>
  )
}

function WorkabilityBadge({
  data,
}: {
  data: { score: string; tone: 'great' | 'good' | 'ok' }
}) {
  const s = WORKABILITY_TONE_STYLES[data.tone]
  return (
    <span
      className="px-1.5 py-0.5 rounded-md text-[10px] sm:text-[11px] font-bold whitespace-nowrap"
      style={{ backgroundColor: s.bg, color: s.color }}
    >
      {data.score}/10 · {s.label}
    </span>
  )
}

export function SpotCard({ spot, className }: SpotCardProps) {
  const open = isOpenNow(spot.hours)
  const hours24 = is24Hours(spot.hours)
  const hoursDisplay = formatHoursDisplay(spot.hours)
  const coverPhoto = spot.photos?.[0]?.url ?? null

  // Single-city site: drop the redundant "New York City" suffix.
  // Show neighborhood if we have it, else just "NYC".
  const locationLabel = spot.neighborhood ?? 'NYC'

  return (
    <Link href={`/spot/${spot.slug}`} className={cn('block', className)}>
      <article
        className="spot-card rounded-xl overflow-hidden border flex flex-col h-full transition-all"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border-subtle)',
        }}
      >
        {/* ── Image ── */}
        <div
          className="relative h-28 sm:h-36 overflow-hidden shrink-0"
          style={{ backgroundColor: 'var(--surface-3)' }}
        >
          <SpotCardImage src={coverPhoto} alt={spot.name} />

          {/* Open/Closed badge */}
          <div className="absolute top-1.5 left-1.5">
            <div
              className={cn(
                'flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold',
                open ? 'pulse-glow' : ''
              )}
              style={{
                backgroundColor: open ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.85)',
                color: open ? 'var(--yes)' : 'var(--text-muted)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: open ? 'var(--yes)' : 'var(--text-muted)' }}
              />
              {hours24 ? '24hr' : open ? 'Open' : 'Closed'}
            </div>
          </div>

          {/* Type badge — only on larger cards (hidden on mobile to save space) */}
          <div className="absolute top-1.5 right-1.5 hidden sm:block">
            <span
              className="px-1.5 py-0.5 rounded-md text-[10px] font-medium"
              style={{
                backgroundColor: 'rgba(255,255,255,0.92)',
                color: 'var(--text-secondary)',
                backdropFilter: 'blur(8px)',
              }}
            >
              {typeLabel(spot.type)}
            </span>
          </div>

          {/* Closing time — bottom-right pill */}
          {!hours24 && (
            <div className="absolute bottom-1.5 right-1.5">
              <span
                className="px-1.5 py-0.5 rounded-md text-[10px] font-medium"
                style={{
                  backgroundColor: 'rgba(27,20,16,0.78)',
                  color: '#F5EDE0',
                  backdropFilter: 'blur(8px)',
                }}
              >
                {hoursDisplay}
              </span>
            </div>
          )}
        </div>

        {/* ── Body ── */}
        <div className="p-2.5 sm:p-3 flex flex-col gap-1.5 sm:gap-2 flex-1">
          {/* Name (removed the auto-stamped Verified mark — every approved
              spot had a last_verified_at set by adminUpdateSpotStatus, which
              made the ✓ meaningless). */}
          <h3
            className="font-semibold text-[13px] sm:text-[15px] leading-tight truncate"
            style={{ color: 'var(--text-primary)' }}
          >
            {spot.name}
          </h3>

          {/* Location */}
          <div className="flex items-center text-[10px] sm:text-[11px] -mt-1" style={{ color: 'var(--text-muted)' }}>
            <span className="truncate">{locationLabel}</span>
          </div>

          {/* ── Headline: workability score (editorial) + positive amenity chips ──
              Previous version showed a fabricated 2x2 chip grid with
              "WIFI:no / OUTLETS:no / LATE:no" on every spot with default
              data. That misled users into thinking we'd judged the spot
              negatively when really we just had no signal. Now we only
              surface positives. */}
          <div className="flex flex-wrap items-center gap-1 mt-auto">
            {(() => {
              const wb = workabilityChip(spot)
              return wb ? <WorkabilityBadge data={wb} /> : null
            })()}
            {positiveChipsForSpot(spot).map((chip) => (
              <PositiveChipBadge key={chip.label} chip={chip} />
            ))}
          </div>
        </div>
      </article>
    </Link>
  )
}
