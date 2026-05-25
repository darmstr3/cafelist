import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import {
  MapPin, Clock, Wifi, Zap,
  Bath, Utensils, Coffee, Monitor, ChevronLeft, Star, Navigation,
} from 'lucide-react'
import { getSpotBySlug, getReviewsBySpotId } from '@/lib/spots'
import {
  isOpenNow, formatHoursDisplay, formatScore,
  typeLabel, is24Hours, formatTime,
} from '@/lib/utils'
import { ReviewForm } from '@/components/ReviewForm'
import { Spot, SpotHours } from '@/types'

interface PageProps {
  params: Promise<{ id: string }>
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const

// ── Workability hero ───────────────────────────────────────────────
// Replaces the old "verdict tiles" that fabricated red badges ("Spotty",
// "Few", "Closes early") on every spot with no reviews. Now the page leads
// with the actual editorial signal (workability_score) when present, and
// is honest about not having one when absent.

function workabilityLabel(score: number): { label: string; color: string; tone: string } {
  if (score >= 8) return { label: 'Great for working', color: 'var(--yes)', tone: 'rgba(47,125,79,0.10)' }
  if (score >= 6) return { label: 'Workable', color: 'var(--yes)', tone: 'rgba(47,125,79,0.08)' }
  if (score >= 4) return { label: 'Workable with friction', color: 'var(--kinda)', tone: 'rgba(198,133,18,0.08)' }
  return { label: 'Not really a work spot', color: 'var(--no)', tone: 'rgba(168,57,47,0.06)' }
}

function WorkabilityHero({ spot }: { spot: Spot }) {
  // No editorial score yet — honest empty state, not red badges.
  if (spot.workability_score == null) {
    return (
      <section
        className="p-4 rounded-xl border mb-6"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
      >
        <p
          className="text-[11px] font-semibold uppercase tracking-wide mb-1"
          style={{ color: 'var(--text-muted)' }}
        >
          Not yet rated
        </p>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          We haven&apos;t given this spot a workability score yet. Check back soon, or leave a
          review to help.
        </p>
      </section>
    )
  }

  const score = Number(spot.workability_score)
  const meta = workabilityLabel(score)
  return (
    <section
      className="p-5 rounded-xl border mb-6"
      style={{ backgroundColor: meta.tone, borderColor: 'var(--border-subtle)' }}
    >
      <div className="flex items-baseline gap-3 mb-2">
        <span
          className="text-[28px] font-bold leading-none"
          style={{ color: meta.color }}
        >
          {score.toFixed(1)}
        </span>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          / 10 workability
        </span>
        <span
          className="ml-auto text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: meta.color }}
        >
          {meta.label}
        </span>
      </div>
      {spot.workability_reasoning && (
        <p className="text-sm leading-relaxed italic" style={{ color: 'var(--text-secondary)' }}>
          &ldquo;{spot.workability_reasoning}&rdquo;
        </p>
      )}
      <p className="text-[10px] mt-2" style={{ color: 'var(--text-muted)' }}>
        Cafelist editorial — based on reviews, hours, and venue type
      </p>
    </section>
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

  // Amenity strip — only shown for amenities we actually know about, no
  // fabricated red badges for "we don't know".
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

        {/* ── Trust block — honest metadata only ──
            Removed "Verified by Donovan" — that was the system auto-stamping
            last_verified_at on approval, not a real human-verified signal.
            Show the neighborhood + review count and leave it at that. */}
        <div className="flex items-center gap-3 flex-wrap text-[12px] mb-5" style={{ color: 'var(--text-muted)' }}>
          {spot.address && (
            <span className="flex items-center gap-1 truncate max-w-[280px]">
              <MapPin size={11} />
              {spot.neighborhood ? `${spot.neighborhood}, ` : ''}
              {spot.city}
            </span>
          )}
          <span>·</span>
          <span>{reviews.length} review{reviews.length === 1 ? '' : 's'}</span>
        </div>

        {/* ── Workability hero ──
            Replaces the old colored verdict tiles ("Spotty", "Few",
            "Closes early") which fabricated red badges on every spot
            with default data. Now we lead with the actual editorial
            signal when present, and show an honest "Not yet rated"
            state when absent. */}
        <WorkabilityHero spot={spot} />

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

            {/* Score breakdown — hide entirely when all-zero (no reviews yet).
                Rendering six 0.0s reads as "this place scores zero on
                everything," which is the opposite of "we don't have data
                yet." */}
            {[
              spot.work_score,
              spot.late_night_score,
              spot.wifi_score,
              spot.outlet_score,
              spot.noise_score,
              spot.seating_score,
            ].some((s) => s > 0) && (
              <section>
                <h2 className="text-[11px] font-semibold mb-3 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  Review-derived scores
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
            )}

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
