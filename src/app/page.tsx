import Link from 'next/link'
import { SpotsDirectory } from '@/components/SpotsDirectory'
import { NearMeBanner } from '@/components/NearMeBanner'
import { UserMenu } from '@/components/UserMenu'
import { getSpots, getCities } from '@/lib/spots'
import { getCurrentUser } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const [{ spots, serviceError }, cities, user] = await Promise.all([
    getSpots(),
    getCities().catch(() => []),
    getCurrentUser().catch(() => null),
  ])

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
      {/* ── Sticky top bar ── */}
      <div
        className="sticky top-0 z-20 border-b"
        style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          {/* Wordmark */}
          <Link href="/" className="flex items-baseline gap-2 shrink-0">
            <span
              className="wordmark text-[18px]"
              style={{ color: 'var(--text-primary)' }}
            >
              Cafelist
            </span>
            <span
              className="text-[11px] hidden sm:inline"
              style={{ color: 'var(--text-muted)' }}
            >
              Worth your time.
            </span>
          </Link>

          {/* Right-side actions */}
          {/* /labs is intentionally not linked here — it's gated by the admin
              middleware while still in-progress. Access it via /labs directly
              with admin credentials. */}
          <div className="ml-auto flex items-center gap-3">
            <Link
              href="/find"
              className="text-[11px] font-medium transition-opacity hover:opacity-80"
              style={{ color: 'var(--accent)' }}
            >
              Find a spot
            </Link>
            <UserMenu initialUser={user} />
            <Link
              href="/submit"
              className="text-[11px] font-medium transition-opacity hover:opacity-80"
              style={{ color: 'var(--text-muted)' }}
            >
              Submit
            </Link>
          </div>
        </div>
      </div>

      {/* ── Near-me hero banner (always-visible CTA) ── */}
      <NearMeBanner />

      {/* ── Directory ── */}
      {serviceError ? (
        <div className="max-w-md mx-auto px-4 sm:px-6 py-24 flex flex-col items-center gap-4 text-center">
          <span className="text-5xl mb-2">☕</span>
          <p
            className="text-base font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            We&apos;re briefly catching up
          </p>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Our database is having a momentary hiccup — usually clears up in a minute. Refresh the page and you should be back in the land of cafés.
          </p>
          <Link
            href="/"
            className="mt-2 px-4 py-2 rounded-lg text-sm font-medium border transition-opacity hover:opacity-80"
            style={{
              backgroundColor: 'var(--accent)',
              color: 'white',
              borderColor: 'var(--accent)',
            }}
          >
            Try again
          </Link>
        </div>
      ) : spots.length === 0 ? (
        <div className="max-w-md mx-auto px-4 sm:px-6 py-24 flex flex-col items-center gap-3 text-center">
          <span className="text-5xl mb-2">☕</span>
          <p
            className="text-base font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            Loading cafés…
          </p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            If this stays empty, refresh the page in a moment.
          </p>
        </div>
      ) : (
        <SpotsDirectory initialSpots={spots} cities={cities} />
      )}
    </div>
  )
}
