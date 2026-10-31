import Link from 'next/link'
import { Coffee } from 'lucide-react'
import { GUIDES } from '@/lib/guides'

// Rendered site-wide from RootLayout (2026-10-31: previously unused —
// no page mounted it, so the site had zero footer-level internal links).
// Doubles as the main internal-linking surface for the guide pages: every
// page on the site now links to all three, and vice versa.
export function Footer() {
  return (
    <footer className="border-t mt-16" style={{ borderColor: 'var(--border-subtle)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
        <nav aria-label="Guides" className="flex flex-col sm:flex-row gap-3 sm:gap-6">
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            Guides
          </span>
          <div className="flex flex-wrap gap-3 text-xs">
            {GUIDES.map((g) => (
              <Link
                key={g.slug}
                href={`/guides/${g.slug}`}
                className="transition-opacity hover:opacity-80"
                style={{ color: 'var(--text-secondary)' }}
              >
                {g.navLabel}
              </Link>
            ))}
            <Link href="/find" className="transition-opacity hover:opacity-80" style={{ color: 'var(--text-secondary)' }}>
              Find a spot
            </Link>
            <Link href="/near-me" className="transition-opacity hover:opacity-80" style={{ color: 'var(--text-secondary)' }}>
              Near me
            </Link>
          </div>
        </nav>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div
              className="w-5 h-5 rounded flex items-center justify-center"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              <Coffee size={10} className="text-white" />
            </div>
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Cafelist
            </span>
          </div>

          <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
            <span>Data from Google Maps · Yelp · Reddit via Apify</span>
            <span>Cached 48 hours per city</span>
          </div>
        </div>
      </div>
    </footer>
  )
}
