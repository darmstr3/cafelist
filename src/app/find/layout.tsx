import type { Metadata } from 'next'

// /find/page.tsx is a 'use client' component and can't export its own
// `metadata` or `generateMetadata` — without this segment layout it was
// silently inheriting the root layout's homepage title/description with no
// canonical, i.e. a duplicate-title page as far as a crawler is concerned.
// Found during the 2026-10-31 SEO pass; same issue existed on /near-me and
// /submit (see their layout.tsx).
export const metadata: Metadata = {
  title: 'Find a Café by Mood | Cafelist',
  description: 'Pick what kind of coffee outing this is — deep work, a client meeting, a coffee date — and get matched to real NYC cafés from Cafelist.',
  alternates: { canonical: '/find' },
}

export default function FindLayout({ children }: { children: React.ReactNode }) {
  return children
}
