import type { Metadata } from 'next'
import { Inter, Fraunces } from 'next/font/google'
import { WebAnalytics } from '@/components/WebAnalytics'
import { PageViewTracker } from '@/components/PageViewTracker'
import { Footer } from '@/components/Footer'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  weight: ['600', '700'],
  display: 'swap',
})

// Homepage-targeted by default — every route segment without its own
// `metadata`/`generateMetadata` inherits this. Routes that need their own
// title (guides, spot pages) override it; routes that previously had no
// metadata at all (/find, /near-me, /submit) now get a per-segment
// `layout.tsx` instead of silently duplicating this title — see those
// folders for why that was a real duplicate-title/no-canonical bug.
export const metadata: Metadata = {
  metadataBase: new URL('https://cafelist.app'),
  title: 'Laptop-Friendly Cafés in NYC | Cafelist',
  description:
    'Find laptop-friendly cafés in NYC with real Wi-Fi, outlets, and noise-level info — not aggregated review-site guesses. Filter by neighborhood, open-late hours, and amenities.',
  keywords: ['laptop friendly cafes nyc', 'coffee shop wifi outlets', 'remote work cafe nyc', 'work from cafe', 'cafe list', 'NYC coffee shops'],
  openGraph: {
    title: 'Laptop-Friendly Cafés in NYC | Cafelist',
    description: 'A handpicked directory of laptop-friendly cafés and hotel lobbies in NYC — Wi-Fi, outlets, noise level, late-night hours.',
    type: 'website',
    siteName: 'Cafelist',
    url: 'https://cafelist.app',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Laptop-Friendly Cafés in NYC | Cafelist',
    description: 'A handpicked directory of laptop-friendly cafés and hotel lobbies in NYC — Wi-Fi, outlets, noise level, late-night hours.',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--background)' }}>
        <main className="flex-1">{children}</main>
        <Footer />
        <WebAnalytics />
        <PageViewTracker />
      </body>
    </html>
  )
}
