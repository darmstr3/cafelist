import type { Metadata } from 'next'

// Same fix as /find/layout.tsx — /near-me/page.tsx is a client component
// with no metadata of its own.
export const metadata: Metadata = {
  title: 'Cafés Near Me in NYC | Cafelist',
  description: 'Find laptop-friendly cafés near your current location in NYC, ranked by distance, from Cafelist.',
  alternates: { canonical: '/near-me' },
}

export default function NearMeLayout({ children }: { children: React.ReactNode }) {
  return children
}
