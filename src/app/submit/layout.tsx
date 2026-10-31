import type { Metadata } from 'next'

// Same fix as /find/layout.tsx — /submit/page.tsx is a client component
// with no metadata of its own.
export const metadata: Metadata = {
  title: 'Submit a Café | Cafelist',
  description: 'Know a laptop-friendly café in NYC that should be on Cafelist? Submit it for review.',
  alternates: { canonical: '/submit' },
}

export default function SubmitLayout({ children }: { children: React.ReactNode }) {
  return children
}
