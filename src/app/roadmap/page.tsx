import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { ROADMAP, RoadmapStatus } from '@/lib/roadmap'

const STATUS_META: Record<RoadmapStatus, { label: string; bg: string; color: string; dot: string }> = {
  shipped:   { label: 'Shipped',   bg: 'rgba(47,125,79,0.12)',  color: 'var(--yes)',   dot: 'var(--yes)' },
  building:  { label: 'Building',  bg: 'rgba(181,83,15,0.12)',  color: 'var(--accent)',dot: 'var(--accent)' },
  next:      { label: 'Next',      bg: 'rgba(198,133,18,0.12)', color: 'var(--kinda)', dot: 'var(--kinda)' },
  exploring: { label: 'Exploring', bg: 'var(--surface-2)',      color: 'var(--text-muted)', dot: 'var(--text-muted)' },
}

function StatusPill({ status }: { status: RoadmapStatus }) {
  const m = STATUS_META[status]
  return (
    <span
      className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ backgroundColor: m.bg, color: m.color }}
    >
      {m.label}
    </span>
  )
}

export const metadata = {
  title: 'Roadmap — Cafelist',
  description: 'What we shipped, what we’re building, and what’s next.',
}

export default function RoadmapPage() {
  const totalItems = ROADMAP.reduce((n, p) => n + p.items.length, 0)
  const shippedCount = ROADMAP.reduce(
    (n, p) => n + p.items.filter((i) => i.status === 'shipped').length,
    0
  )
  const pct = Math.round((shippedCount / totalItems) * 100)

  return (
    <div className="min-h-screen">
      {/* ── Top bar ── */}
      <div
        className="sticky top-0 z-20 border-b"
        style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-xs font-medium transition-opacity hover:opacity-70"
            style={{ color: 'var(--text-muted)' }}
          >
            <ChevronLeft size={13} />
            Back
          </Link>
          <span
            className="ml-auto wordmark text-[15px]"
            style={{ color: 'var(--text-primary)' }}
          >
            Cafelist
          </span>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        {/* ── Header ── */}
        <header className="mb-10">
          <p
            className="text-[11px] font-semibold uppercase tracking-wider mb-2"
            style={{ color: 'var(--text-muted)' }}
          >
            Product Roadmap
          </p>
          <h1
            className="wordmark text-[36px] sm:text-[44px] leading-tight mb-3"
            style={{ color: 'var(--text-primary)' }}
          >
            What we&rsquo;ve shipped, what&rsquo;s next.
          </h1>
          <p className="text-sm leading-relaxed max-w-xl" style={{ color: 'var(--text-secondary)' }}>
            Built in public. Updated as things move. Feedback welcome via{' '}
            <a
              href="mailto:armstrongdonovan3@gmail.com"
              className="underline"
              style={{ color: 'var(--accent)' }}
            >
              email
            </a>
            .
          </p>

          {/* Progress meter */}
          <div className="mt-6 max-w-sm">
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--text-muted)' }}>
                v1 progress
              </span>
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {shippedCount} of {totalItems} shipped &middot; {pct}%
              </span>
            </div>
            <div
              className="h-2 rounded-full overflow-hidden"
              style={{ backgroundColor: 'var(--surface-2)' }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: 'var(--yes)' }}
              />
            </div>
          </div>
        </header>

        {/* ── Phases ── */}
        <div className="space-y-12">
          {ROADMAP.map((phase) => (
            <section key={phase.id}>
              <div className="flex items-baseline gap-3 mb-1">
                <h2
                  className="wordmark text-[24px] sm:text-[28px]"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {phase.name}
                </h2>
                <span
                  className="text-xs uppercase tracking-wide"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {phase.subtitle}
                </span>
              </div>

              <div
                className="border-l-2 pl-5 sm:pl-6 ml-2 mt-5 space-y-5"
                style={{ borderColor: 'var(--border)' }}
              >
                {phase.items.map((item) => {
                  const m = STATUS_META[item.status]
                  return (
                    <div key={item.title} className="relative">
                      {/* Timeline dot */}
                      <span
                        className="absolute w-2.5 h-2.5 rounded-full -left-[26px] sm:-left-[31px] top-2"
                        style={{
                          backgroundColor: m.dot,
                          boxShadow: `0 0 0 4px var(--background)`,
                        }}
                      />
                      <div className="flex items-start gap-2 flex-wrap mb-1">
                        <h3
                          className="font-semibold text-[15px] leading-snug"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {item.title}
                        </h3>
                        <StatusPill status={item.status} />
                      </div>
                      <p className="text-sm leading-relaxed mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                        {item.description}
                      </p>
                      {item.rationale && (
                        <p
                          className="text-[12px] leading-relaxed italic"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          Why: {item.rationale}
                        </p>
                      )}
                      {item.shippedAt && (
                        <p
                          className="text-[11px] mt-1"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          Shipped {new Date(item.shippedAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>

        {/* ── Footer note ── */}
        <footer
          className="mt-16 pt-8 border-t text-xs leading-relaxed"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
        >
          <p>
            Roadmap items move from <em>Exploring</em> &rarr; <em>Next</em> &rarr; <em>Building</em> &rarr;{' '}
            <em>Shipped</em>. Items can also leave the roadmap entirely if the call is to deprioritize permanently.
          </p>
          <p className="mt-2">
            Source of truth lives at{' '}
            <code
              className="px-1.5 py-0.5 rounded text-[11px]"
              style={{ backgroundColor: 'var(--surface-2)' }}
            >
              src/lib/roadmap.ts
            </code>
            .
          </p>
        </footer>
      </div>
    </div>
  )
}
