'use client'

import Link from 'next/link'
import { Coffee } from 'lucide-react'

export function Nav() {
  return (
    <nav
      className="sticky top-0 z-50 border-b"
      style={{
        backgroundColor: 'rgba(250,247,242,0.92)',
        backdropFilter: 'blur(12px)',
        borderColor: 'var(--border-subtle)',
      }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            <Coffee size={14} className="text-white" />
          </div>
          <span className="font-semibold text-sm tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Cafelist
          </span>
        </Link>

        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span
            className="px-2 py-1 rounded-md border hidden sm:block"
            style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--border)' }}
          >
            🗺 Google Maps + Yelp + Reddit
          </span>
        </div>
      </div>
    </nav>
  )
}
