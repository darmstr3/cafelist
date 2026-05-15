import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import {
  MapPin, Clock, Wifi, Zap, Volume2, Moon,
  Bath, Utensils, Coffee, Monitor, ChevronLeft, Star, Navigation,
} from 'lucide-react'
import { getSpotBySlug, getReviewsBySpotId } from '@/lib/spots'
import {
  isOpenNow, formatHoursDisplay, formatScore,
  typeLabel, is24Hours, formatTime, isOpenAfter9pm, isOpenAfterMidnight,
} from '@/lib/utils'
import { ReviewForm } from '@/components/ReviewForm'
import { Spot, SpotHours } from '@/types'

interface PageProps {
  params: Promise<{ id: string }>
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const

// ── Verdicts: yes/ok/no per dimension, plus a one-word headline ────

type VerdictState = 'yes' | 'kinda' | 'no' | 'unknown'

interface Verdict {
  state: VerdictState
  word: string
}

function wifiVerdict(spot: Spot): Verdict {
  if (!spot.has_wifi) return { state: 'no', word: 'No Wi-Fi' }
  if (spot.wifi_score >= 6.5) return { state: 'yes', word: 'Strong' }
  if (spot.wifi_score >= 4) return { state: 'kinda', word: 'OK' }
  return { state: 'no', word: 'Spotty' }
}

function outletVerdict(spot: Spot): Verdict {
  if (!spot.has_outlets) return { state: 'no', word: 'Few' }
  if (spot.outlet_score >= 6.5) return { state: 'yes', word: 'Plenty' }
  if (spot.outlet_score >= 4) return { state: 'kinda', word: 'Some' }
  return { state: 'no', word: 'Few' }
}

function quietVerdict(spot: Spot): Verdict {
  if (!spot.noise_level) return { state: 'unknown', word: '—' }
  if (spot.noise_level === 'silent') return { state: 'yes', word: 'Silent' }
  if (spot.noise_level === 'quiet') return { state: 'yes', word: 'Calm' }
  if (spot.noise_level === 'moderate') return { state: 'kinda', word: 'Moderate' }
  return { state: 'no', word: 'Loud' }
}

function lateVerdict(spot: Spot): Verdict {
  if (is24Hours(spot.hours)) return { state: 'yes', word: 'Open 24h' }
  if (isOpenAfterMidnight(spot.hours)) return { state: 'yes', word: 'Past midnight' }
  if (isOpenAfter9pm(spot.hours)) {
    // Try to surface the actual close time today, e.g. "Until 11pm"
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()
    const t = spot.hours?.[today as keyof SpotHours]
    return { state: 'kinda', word: t ? `Until ${formatTime(t.close)}` : 'Open late' }
  }
  return { state: 'no', word: 'Closes early' }
}

const VERDICT_STYLES: Record<VerdictState, { bg: string; color: string; border: string }> = {
  yes:     { bg: 'rgba(47,125,79,0.10)',  color: 'var(--yes)',          border: 'rgba(47,125,79,0.25)' },
  kinda:   { bg: 'rgba(198,133,18,0.10)', color: 'var(--kinda)',        border: 'rgba(198,133,18,0.25)' },
  no:      { bg: 'rgba(168,57,47,0.08)',  color: 'var(--no)',           border: 'rgba(168,57,47,0.22)' },
  unknown: { bg: 'var(--surface-2)',       color: 'var(--text-muted)',   border: 'var(--border)' },
}

function VerdictTile({
  icon: Icon, label, verdict, score,
}: {
  icon: typeof Wifi
  label: string
  verdict: Verdict
  score: number
}) {
  const s = VERDICT_STYLES[verdict.state]
  return (
    <div
      className="p-4 rounded-xl border flex flex-col gap-1"
      style={{ backgroundColor: s.bg, borderColor: s.border }}
    >
      <div className="flex items-center justify-between">
        <Icon size={16} style={{ color: s.color }} />
        <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: s.color, opacity: 0.7 }}>
          {label}
        </span>
      </div>
      <div className="text-base font-semibold leading-tight" style={{ color: s.color }}>
        {verdict.word}
      </div>
      {verdict.state !== 'unknown' && (
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {formatScore(score)} / 10
        </div>
      )}
    </div>
  )
}

// ── Hours table ────────────────────────────────────────────────────

function HoursTable({ hours }: { hours: SpotHours }) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()
  return (
    <div className="space-y-1">
      {DAYS.map((day) => {
        const h = hours[day]
        const isToday = today === day
        return (
          <div
            key={day}
            className={`flex justify-between items-center py-1.5 px-2 rounded-md text-xs ${isToday ? 'font-semibold' : ''}`}
            style={{
              backgroundColor: isToday ? 'var(--surface-2)' : 'transparent',
              color: isToday ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
          >
            <span className="capitalize w-20">{day}</span>
            {h ? (
              <span style={{ color: isToday ? 'var(--accent)' : 'var(--text-secondary)' }}>
                {formatTime(h.open)} – {formatTime(h.close)}
              </span>
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>Closed</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Star rating widget ────────────────────────────────────────────

function StarRating({ value }: { value: number | null }) {
  if (!value) return <span style={{ color: 'var(--text-muted)' }}>–</span>
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={12}
          fill={i <= value ? 'var(--kinda)' : 'none'}
          style={{ color: i <= value ? 'var(--kinda)' : 'var(--border)' }}
        />
      ))}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────

export default async function SpotDetailPage({ params }: PageProps) {
  const { id: slug } = await params
  const spot = await getSpotBySlug(slug)
  if (!spot) notFound()

  const reviews = await getReviewsBySpotId(spot.id)
  const sortedReviews = [...reviews].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  const open = isOpenNow(spot.hours)
  const hours24 = is24Hours(spot.hours)
  const heroPhoto = spot.photos?.[0]
  const otherPhotos = spot.photos?.slice(1) ?? []

  const verifiedDate = spot.last_verified_at
    ? new Date(spot.last_verified_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  // Brief §3.1: amenities are useful but secondary. Keep below verdict bar.
  const amenities = [
    { icon: Wifi, label: 'Wi-Fi', active: spot.has_wifi },
    { icon: Zap, label: 'Outlets', active: spot.has_outlets },
    { icon: Monitor, label: 'Laptop-friendly', active: spot.laptop_friendly },
    { icon: Bath, label: 'Bathroom', active: spot.has_bathroom },
    { icon: Utensils, label: 'Food', active: spot.has_food },
    { icon: Coffee, label: 'Drinks', active: spot.has_drinks },
  ]

  return (
    <div className="min-h-screen pb-20 lg:pb-8">
      {/* ── Hero photo (40vh, full-width) ── */}
      {heroPhoto ? (
        <div className="relative w-full h-[40vh] min-h-[280px]">
          <Image
            src={heroPhoto.url}
            alt={spot.name}
            fill
            sizes="100vw"
            className="object-cover"
            priority
            unoptimized
          />
          <div className="absolute inset-0" style={{
            background: 'linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 60%, rgba(27,20,16,0.45) 100%)',
          }} />
          {/* Back link overlay */}
          <Link
            href="/"
            className="absolute top-4 left-4 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium"
            style={{
              backgroundColor: 'rgba(255,255,255,0.92)',
              color: 'var(--text-primary)',
              backdropFilter: 'blur(8px)',
            }}
          >
            <ChevronLeft size={13} />
            Back
          </Link>
        </div>
      ) : (
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm transition-opacity hover:opacity-80"
            style={{ color: 'var(--text-secondary)' }}
          >
            <ChevronLeft size={14} />
            All spots
          </Link>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6">
        {/* ── H1 + vibe inline ── */}
        <div className="mb-3">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span
              className="text-[11px] px-2 py-0.5 rounded-md font-medium"
              style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)' }}
            >
              {typeLabel(spot.type)}
            </span>
            <span
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium ${open ? 'pulse-glow' : ''}`}
              style={{
                backgroundColor: open ? 'rgba(47,125,79,0.10)' : 'var(--surface-2)',
                color: open ? 'var(--yes)' : 'var(--text-muted)',
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: open ? 'var(--yes)' : 'var(--text-muted)' }} />
              {hours24 ? '24 Hours' : open ? 'Open' : 'Closed'} · {formatHoursDisplay(spot.hours)}
            </span>
          </div>

          <h1 className="font-bold leading-tight wordmark text-[32px] sm:text-[40px]" style={{ color: 'var(--text-primary)' }}>
            {spot.name}
          </h1>

          {/* Vibe tags directly under H1 (per brief §3.3) */}
          {spot.vibe_tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {spot.vibe_tags.map((tag) => (
                <span
                  key={tag}
                  className="text-[11px] px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: 'var(--surface-2)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ── Trust block (3 inline signals) ── */}
        <div className="flex items-center gap-3 flex-wrap text-[12px] mb-5" style={{ color: 'var(--text-muted)' }}>
          {verifiedDate && (
            <>
              <span className="flex items-center gap-1">
                <span style={{ color: 'var(--accent)', fontWeight: 600 }}>✓ Verified</span>
                by Donovan · {verifiedDate}
              </span>
              <span>·</span>
            </>
          )}
          <span>{reviews.length} review{reviews.length === 1 ? '' : 's'}</span>
          {spot.address && (
            <>
              <span>·</span>
              <span className="flex items-center gap-1 truncate max-w-[280px]">
                <MapPin size={11} />
                {spot.neighborhood ? `${spot.neighborhood}, ` : ''}
                {spot.city}
              </span>
            </>
          )}
        </div>

        {/* ── 4-tile verdict bar (replaces numeric grid as the headline) ── */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <VerdictTile icon={Wifi}   label="Wi-Fi"   verdict={wifiVerdict(spot)}   score={spot.wifi_score} />
          <VerdictTile icon={Zap}    label="Outlets" verdict={outletVerdict(spot)} score={spot.outlet_score} />
          <VerdictTile icon={Volume2} label="Quiet"   verdict={quietVerdict(spot)}  score={spot.noise_score} />
          <VerdictTile icon={Moon}   label="Late"    verdict={lateVerdict(spot)}   score={spot.late_night_score} />
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── Left column ── */}
          <div className="lg:col-span-2 space-y-6">
            {/* Notes — placed near top for narrative */}
            {spot.notes && (
              <section
                className="p-4 rounded-xl border-l-2"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--accent)',
                  borderLeftWidth: '3px',
                }}
              >
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  {spot.notes}
                </p>
              </section>
            )}

            {/* Amenities */}
            <section>
              <h2 className="text-[11px] font-semibold mb-3 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                Amenities
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {amenities.map(({ icon: Icon, label, active }) => (
                  <div
                    key={label}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm"
                    style={{
                      backgroundColor: active ? 'rgba(47,125,79,0.06)' : 'var(--surface-2)',
                      borderColor: active ? 'rgba(47,125,79,0.25)' : 'var(--border-subtle)',
                      color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                    }}
                  >
                    <Icon size={14} style={{ color: active ? 'var(--yes)' : 'var(--text-muted)' }} />
                    {label}
                  </div>
                ))}
              </div>
            </section>

            {/* Score breakdown — collapsed-feeling, secondary */}
            <section>
              <h2 className="text-[11px] font-semibold mb-3 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                Score breakdown
              </h2>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {[
                  { label: 'Work', score: spot.work_score },
                  { label: 'Late', score: spot.late_night_score },
                  { label: 'Wi-Fi', score: spot.wifi_score },
                  { label: 'Outlets', score: spot.outlet_score },
                  { label: 'Noise', score: spot.noise_score },
                  { label: 'Seating', score: spot.seating_score },
                ].map(({ label, score }) => (
                  <div
                    key={label}
                    className="p-2 rounded-lg border text-center"
                    style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
                  >
                    <div className="text-[16px] font-bold" style={{ color: 'var(--text-primary)' }}>
                      {formatScore(score)}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                      {label}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Reviews — most recent first */}
            <section>
              <h2 className="text-[11px] font-semibold mb-3 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                Reviews ({reviews.length})
              </h2>
              {sortedReviews.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  No reviews yet. Be the first to review this spot.
                </p>
              ) : (
                <div className="space-y-3">
                  {sortedReviews.map((review) => (
                    <div
                      key={review.id}
                      className="p-4 rounded-xl border"
                      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                          {review.author_name}
                        </span>
                        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {new Date(review.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                        <div>
                          <p className="text-[10px] mb-0.5" style={{ color: 'var(--text-muted)' }}>Wi-Fi</p>
                          <StarRating value={review.wifi_rating} />
                        </div>
                        <div>
                          <p className="text-[10px] mb-0.5" style={{ color: 'var(--text-muted)' }}>Outlets</p>
                          <StarRating value={review.outlet_rating} />
                        </div>
                        <div>
                          <p className="text-[10px] mb-0.5" style={{ color: 'var(--text-muted)' }}>Late Night</p>
                          <StarRating value={review.late_night_rating} />
                        </div>
                        <div>
                          <p className="text-[10px] mb-0.5" style={{ color: 'var(--text-muted)' }}>Seating</p>
                          <StarRating value={review.seating_rating} />
                        </div>
                      </div>
                      {review.comment && (
                        <p className="text-sm leading-relaxed line-clamp-5" style={{ color: 'var(--text-secondary)' }}>
                          {review.comment}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-6">
                <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>
                  Leave a review
                </h3>
                <ReviewForm spotId={spot.id} />
              </div>
            </section>
          </div>

          {/* ── Right column ── */}
          <div className="space-y-4">
            {/* Hours */}
            {spot.hours && (
              <div
                className="p-4 rounded-xl border"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
              >
                <h3 className="text-[11px] font-semibold uppercase tracking-wide mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                  <Clock size={12} />
                  Hours
                </h3>
                {hours24 ? (
                  <div
                    className="text-center py-3 rounded-lg text-sm font-semibold"
                    style={{ backgroundColor: 'rgba(47,125,79,0.08)', color: 'var(--yes)' }}
                  >
                    Open 24 hours
                  </div>
                ) : (
                  <HoursTable hours={spot.hours} />
                )}
              </div>
            )}

            {/* Map + directions */}
            {spot.lat && spot.lng && (
              <div
                className="rounded-xl border overflow-hidden"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <iframe
                  title="Map"
                  width="100%"
                  height="220"
                  src={`https://maps.google.com/maps?q=${spot.lat},${spot.lng}&z=15&output=embed`}
                  allowFullScreen
                  loading="lazy"
                />
                <div className="grid grid-cols-2 gap-0 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <a
                    href={`https://maps.apple.com/?q=${encodeURIComponent(spot.name)}&address=${encodeURIComponent(spot.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-center py-2.5 text-xs font-medium transition-colors hover:bg-[var(--surface-2)]"
                    style={{ color: 'var(--accent)' }}
                  >
                    Apple Maps
                  </a>
                  <a
                    href={
                      spot.google_place_id
                        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(spot.name + ' ' + spot.address)}&query_place_id=${spot.google_place_id}`
                        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(spot.name + ' ' + spot.address)}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-center py-2.5 text-xs font-medium transition-colors hover:bg-[var(--surface-2)] border-l"
                    style={{ color: 'var(--accent)', borderColor: 'var(--border-subtle)' }}
                  >
                    Google Maps
                  </a>
                </div>
              </div>
            )}

            {/* Other photos */}
            {otherPhotos.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {otherPhotos.slice(0, 4).map((photo, i) => (
                  <div
                    key={i}
                    className="relative aspect-square rounded-lg overflow-hidden"
                    style={{ backgroundColor: 'var(--surface-3)' }}
                  >
                    <Image
                      src={photo.url}
                      alt={photo.caption ?? `${spot.name} ${i + 2}`}
                      fill
                      sizes="(max-width: 640px) 50vw, 25vw"
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Sticky bottom bar (mobile only): Apple Maps + Google Maps ── */}
      {spot.lat && spot.lng && (
        <div
          className="fixed bottom-0 left-0 right-0 lg:hidden p-3 border-t flex gap-2"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: 'var(--border-subtle)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <a
            href={`https://maps.apple.com/?q=${encodeURIComponent(spot.name)}&address=${encodeURIComponent(spot.address)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold border"
            style={{
              backgroundColor: 'var(--surface)',
              color: 'var(--accent)',
              borderColor: 'var(--accent)',
            }}
          >
            <Navigation size={15} />
            Apple Maps
          </a>
          <a
            href={
              spot.google_place_id
                ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(spot.name + ' ' + spot.address)}&query_place_id=${spot.google_place_id}`
                : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(spot.name + ' ' + spot.address)}`
            }
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold"
            style={{ backgroundColor: 'var(--accent)', color: 'white' }}
          >
            <Navigation size={15} />
            Google Maps
          </a>
        </div>
      )}
    </div>
  )
}
