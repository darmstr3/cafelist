import Link from 'next/link'
import Image from 'next/image'
import { Coffee } from 'lucide-react'
import { Spot } from '@/types'
import {
  cn,
  isOpenNow,
  formatHoursDisplay,
  typeLabel,
  is24Hours,
  isOpenAfter9pm,
  isOpenAfterMidnight,
  isDataConfidenceUnknown,
  isDataConfidenceVerified,
} from '@/lib/utils'
import { workabilityTierForScore } from '@/lib/workability'

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

type WorkabilityChipData =
  // `estimate: true` = confidence is "inferred", not "verified" — a real
  // AI/editorial score, just not confirmed recently. Shown with a
  // distinct "Est." marker rather than hidden, per the 2026-10-31 UX
  // review: hiding every score more than 90 days stale would blank out
  // all 176 approved venues today, which overcorrects past "unknown" and
  // into "uninformative." Only a true zero-signal row (isDataConfidenceUnknown)
  // gets the full "Not yet verified" placeholder below.
  | { kind: 'score'; score: number; estimate: boolean }
  | { kind: 'unverified' }

function workabilityChip(spot: Spot): WorkabilityChipData | null {
  if (spot.workability_score == null) return null
  // Zero signal at all — don't present a precise one-decimal number we
  // can't stand behind in any form. See isDataConfidenceUnknown() in
  // lib/utils.ts.
  if (isDataConfidenceUnknown(spot)) return { kind: 'unverified' }
  const s = Number(spot.workability_score)
  if (workabilityTierForScore(s) == null) return null // hide low scores — no need to advertise a 2.5
  const estimate = !isDataConfidenceVerified(spot)
  return { kind: 'score', score: s, estimate }
}

const CHIP_TONE_STYLES: Record<PositiveChip['tone'], { bg: string; color: string }> = {
  strong: { bg: 'rgba(47,125,79,0.14)', color: 'var(--yes)' },
  soft:   { bg: 'rgba(47,125,79,0.06)', color: 'var(--yes)' },
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

// ── Grade stamp ─────────────────────────────────────────────
// Previously a single line of small gray text ("8.2/10 · great")
// competing with the Wi-Fi/Outlets chips for attention — on the
// one product whose whole premise is "we scored this." Now it's
// the loudest thing in the card: a round stamp with the number,
// a filled ring in the tier color, and the tier word spelled out
// next to it. Same thresholds, same "· est." honesty marker,
// just weighted like it's the point.
function WorkabilityBadge({ data }: { data: WorkabilityChipData }) {
  if (data.kind === 'unverified') {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] sm:text-[11px] font-semibold whitespace-nowrap"
        style={{ backgroundColor: 'var(--surface-3)', color: 'var(--text-muted)' }}
      >
        Not yet verified
      </span>
    )
  }
  const tier = workabilityTierForScore(data.score)
  if (!tier) return null
  return (
    <span
      className="inline-flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full whitespace-nowrap"
      style={{ backgroundColor: tier.bgStrong, boxShadow: `inset 0 0 0 1px ${tier.ring}` }}
      title={data.estimate ? 'Estimated from reviews, hours, and venue type — not reconfirmed recently' : undefined}
    >
      <span
        className="flex items-center justify-center w-5 h-5 sm:w-[22px] sm:h-[22px] rounded-full text-[10px] sm:text-[11px] font-extrabold leading-none"
        style={{ backgroundColor: tier.color, color: 'var(--surface)' }}
      >
        {Math.round(data.score)}
      </span>
      <span className="text-[10px] sm:text-[11px] font-bold leading-none" style={{ color: tier.color }}>
        {tier.short}
        {data.estimate && (
          <span className="font-semibold opacity-60" style={{ fontWeight: 500 }}>
            {' '}· est.
          </span>
        )}
      </span>
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
          {coverPhoto ? (
            <Image
              src={coverPhoto}
              alt={spot.name}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-cover"
              unoptimized
            />
          ) : (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{ color: 'var(--text-muted)', opacity: 0.4 }}
            >
              <Coffee size={36} strokeWidth={1.2} />
            </div>
          )}

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
