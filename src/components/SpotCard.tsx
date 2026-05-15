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
} from '@/lib/utils'

interface SpotCardProps {
  spot: Spot
  className?: string
}

// ── Semantic signal: yes / kinda / no / unknown ───────────────
// We tell the user "is the wifi good, kinda, or no" instead of
// "5.6 WIFI" because numbers without a key are meaningless.

type SignalState = 'yes' | 'kinda' | 'no' | 'unknown'

function signalForWifi(spot: Spot): SignalState {
  if (!spot.has_wifi) return 'no'
  if (spot.wifi_score >= 6.5) return 'yes'
  if (spot.wifi_score >= 4) return 'kinda'
  return 'no'
}

function signalForOutlets(spot: Spot): SignalState {
  if (!spot.has_outlets) return 'no'
  if (spot.outlet_score >= 6.5) return 'yes'
  if (spot.outlet_score >= 4) return 'kinda'
  return 'no'
}

function signalForQuiet(spot: Spot): SignalState {
  if (!spot.noise_level) return 'unknown'
  if (spot.noise_level === 'silent' || spot.noise_level === 'quiet') return 'yes'
  if (spot.noise_level === 'moderate') return 'kinda'
  return 'no'
}

function signalForLate(spot: Spot): SignalState {
  if (is24Hours(spot.hours)) return 'yes'
  if (isOpenAfterMidnight(spot.hours)) return 'yes'
  if (isOpenAfter9pm(spot.hours)) return 'kinda'
  return 'no'
}

const SIGNAL_STYLES: Record<SignalState, { bg: string; color: string; label: string }> = {
  yes:     { bg: 'rgba(47,125,79,0.14)',  color: 'var(--yes)',   label: 'yes' },
  kinda:   { bg: 'rgba(198,133,18,0.14)', color: 'var(--kinda)', label: 'ok' },
  no:      { bg: 'rgba(168,57,47,0.14)',  color: 'var(--no)',    label: 'no' },
  unknown: { bg: 'var(--surface-2)',      color: 'var(--text-muted)', label: '?' },
}

function relativeDays(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days < 1) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function SignalChip({ name, state }: { name: string; state: SignalState }) {
  const s = SIGNAL_STYLES[state]
  return (
    <div
      className="flex items-center justify-between gap-1 px-1.5 py-1 rounded-md flex-1 min-w-0"
      style={{ backgroundColor: s.bg }}
    >
      <span
        className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-wide truncate"
        style={{ color: s.color, opacity: 0.85 }}
      >
        {name}
      </span>
      <span
        className="text-[9px] sm:text-[10px] font-bold capitalize"
        style={{ color: s.color }}
      >
        {s.label}
      </span>
    </div>
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
          {/* Name + verification mark */}
          <div className="flex items-center gap-1 min-w-0">
            <h3
              className="font-semibold text-[13px] sm:text-[15px] leading-tight truncate"
              style={{ color: 'var(--text-primary)' }}
            >
              {spot.name}
            </h3>
            {spot.last_verified_at && (
              <span
                title="Verified in person"
                className="text-[11px] shrink-0"
                style={{ color: 'var(--accent)' }}
              >
                ✓
              </span>
            )}
          </div>

          {/* Location + (only positive) verification status — single line */}
          <div className="flex items-center text-[10px] sm:text-[11px] -mt-1" style={{ color: 'var(--text-muted)' }}>
            <span className="truncate">
              {locationLabel}
              {spot.last_verified_at && (
                <>
                  {' · '}
                  <span style={{ color: 'var(--accent)' }}>
                    Verified {relativeDays(spot.last_verified_at)}
                  </span>
                </>
              )}
            </span>
          </div>

          {/* ── Semantic signal grid — 2x2 always, density-tuned for mobile ── */}
          <div className="grid grid-cols-2 gap-1 mt-auto">
            <SignalChip name="Wi-Fi" state={signalForWifi(spot)} />
            <SignalChip name="Outlets" state={signalForOutlets(spot)} />
            <SignalChip name="Quiet" state={signalForQuiet(spot)} />
            <SignalChip name="Late" state={signalForLate(spot)} />
          </div>
        </div>
      </article>
    </Link>
  )
}
