import { SpotsDirectory } from '@/components/SpotsDirectory'
import { getSpots, getCities } from '@/lib/spots'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const [{ spots, serviceError }, cities] = await Promise.all([
    getSpots(),
    getCities().catch(() => []),
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
          <a href="/" className="flex items-baseline gap-2 shrink-0">
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
          </a>

          {/* Right-side actions */}
          <div className="ml-auto flex items-center gap-3">
            <a
              href="/labs"
              className="text-[11px] font-medium transition-opacity hover:opacity-80 inline-flex items-center gap-1"
              style={{ color: 'var(--accent)' }}
            >
              <span>Labs</span>
              <span
                className="text-[9px] px-1 py-0.5 rounded uppercase tracking-wide"
                style={{ backgroundColor: 'var(--accent-glow)', color: 'var(--accent)' }}
              >
                new
              </span>
            </a>
            <a
              href="/submit"
              className="text-[11px] font-medium transition-opacity hover:opacity-80"
              style={{ color: 'var(--text-muted)' }}
            >
              Submit a spot
            </a>
          </div>
        </div>
      </div>

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
          <a
            href="/"
            className="mt-2 px-4 py-2 rounded-lg text-sm font-medium border transition-opacity hover:opacity-80"
            style={{
              backgroundColor: 'var(--accent)',
              color: 'white',
              borderColor: 'var(--accent)',
            }}
          >
            Try again
          </a>
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
