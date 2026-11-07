import Link from 'next/link'
import Image from 'next/image'
import { Coffee, ArrowUpRight } from 'lucide-react'
import { Spot } from '@/types'
import { isOpenNow } from '@/lib/utils'
import { workabilityTierForScore } from '@/lib/workability'

// ─────────────────────────────────────────────────────────────
// TodaysPick — the homepage had nothing on it that changes. Every
// visitor, any day, saw the identical static grid: no live signal,
// no reason to come back tomorrow. (This is the thing Nomad List
// does well that Cafelist didn't — a page that feels inhabited,
// not just indexed.)
//
// This is a single deterministic daily highlight, computed from
// data already fetched for the homepage grid — no new query, no
// schema change, no cron job. "Deterministic" matters here: same
// pick for everyone on a given NYC day, and it changes at midnight
// without any infrastructure to keep running. Eligible pool is
// capped to open, scored (>= 4) spots so the pick is never "today's
// pick: a place that's closed and mediocre."
// ─────────────────────────────────────────────────────────────

function dayOfYearNYC(): number {
  const now = new Date()
  const nyc = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const start = new Date(nyc.getFullYear(), 0, 0)
  const diff = nyc.getTime() - start.getTime()
  return Math.floor(diff / 86_400_000)
}

export function TodaysPick({ spots }: { spots: Spot[] }) {
  const eligible = spots
    .filter((s) => s.workability_score != null)
    .filter((s) => workabilityTierForScore(Number(s.workability_score)) != null)
    .filter((s) => isOpenNow(s.hours))
    // Stable order so the "random" pick doesn't jump around between
    // requests that happen to fetch spots in a different order.
    .sort((a, b) => a.slug.localeCompare(b.slug))

  if (eligible.length === 0) return null

  const pick = eligible[dayOfYearNYC() % eligible.length]!
  const tier = workabilityTierForScore(Number(pick.workability_score))!
  const coverPhoto = pick.photos?.[0]?.url ?? null

  return (
    <div
      className="border-b"
      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-5">
        <Link
          href={`/spot/${pick.slug}`}
          className="group flex items-center gap-4 rounded-xl p-2 -m-2 transition-colors hover:bg-[var(--surface-2)]"
        >
          <div
            className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden shrink-0"
            style={{ backgroundColor: 'var(--surface-3)' }}
          >
            {coverPhoto ? (
              <Image
                src={coverPhoto}
                alt={pick.name}
                fill
                sizes="80px"
                className="object-cover"
                unoptimized
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center" style={{ color: 'var(--text-muted)', opacity: 0.4 }}>
                <Coffee size={24} strokeWidth={1.2} />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p
              className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider mb-0.5 flex items-center gap-1.5"
              style={{ color: 'var(--accent)' }}
            >
              <span className="w-1.5 h-1.5 rounded-full pulse-glow shrink-0" style={{ backgroundColor: 'var(--accent)' }} />
              Today&rsquo;s pick · open now
            </p>
            <h3
              className="wordmark text-[18px] sm:text-[22px] font-bold leading-tight truncate"
              style={{ color: 'var(--text-primary)' }}
            >
              {pick.name}
            </h3>
            <p className="text-[12px] sm:text-[13px] truncate" style={{ color: 'var(--text-secondary)' }}>
              {pick.neighborhood ? `${pick.neighborhood} · ` : ''}
              <span className="font-semibold" style={{ color: tier.color }}>
                {Number(pick.workability_score).toFixed(1)}/10 {tier.short.toLowerCase()}
              </span>
            </p>
          </div>

          <ArrowUpRight
            size={18}
            className="shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            style={{ color: 'var(--text-muted)' }}
          />
        </Link>
      </div>
    </div>
  )
}
