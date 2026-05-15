import type { Metadata } from 'next'
import { Inter, Fraunces } from 'next/font/google'
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

export const metadata: Metadata = {
  title: 'Cafelist — Worth your time',
  description:
    'A handpicked directory of coffee shops and hotel lobbies actually worth your time. Wi-Fi, outlets, noise level, late-night hours — verified, not aggregated.',
  keywords: ['coffee shop', 'remote work', 'laptop friendly', 'wifi', 'hotel lobby', 'work from cafe', 'cafe list', 'NYC'],
  openGraph: {
    title: 'Cafelist — Worth your time',
    description: 'A handpicked directory of cafés and hotel lobbies actually worth your time.',
    type: 'website',
    siteName: 'Cafelist',
    url: 'https://cafelist.app',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Cafelist — Worth your time',
    description: 'A handpicked directory of cafés and hotel lobbies actually worth your time.',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--background)' }}>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  )
}
