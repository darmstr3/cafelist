import { Coffee } from 'lucide-react'

export function Footer() {
  return (
    <footer className="border-t mt-16" style={{ borderColor: 'var(--border-subtle)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
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
    </footer>
  )
}
