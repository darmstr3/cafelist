import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { GUIDES, getGuide, getGuideSpots } from '@/lib/guides'
import { SpotCard } from '@/components/SpotCard'

const SITE = 'https://cafelist.app'

interface PageProps {
  params: Promise<{ slug: string }>
}

// Exactly 3 static pages — deliberately not a combinatorial generator.
// See lib/guides.ts for why each one is safe to ship (real, nonzero counts).
export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const guide = getGuide(slug)
  if (!guide) return { title: 'Guide not found | Cafelist', robots: { index: false, follow: false } }
  const url = `/guides/${guide.slug}`
  return {
    title: guide.title,
    description: guide.description,
    alternates: { canonical: url },
    openGraph: {
      title: guide.title,
      description: guide.description,
      url,
      type: 'website',
      siteName: 'Cafelist',
    },
    twitter: {
      card: 'summary',
      title: guide.title,
      description: guide.description,
    },
  }
}

// Revalidate hourly, same cadence as sitemap.ts — these are backed by live
// data (real spot counts can shift as venues are added/approved), not
// hand-written copy, so they shouldn't go fully static forever.
export const revalidate = 3600

export default async function GuidePage({ params }: PageProps) {
  const { slug } = await params
  const guide = getGuide(slug)
  if (!guide) notFound()

  const { spots, serviceError } = await getGuideSpots(guide)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: guide.title,
    description: guide.description,
    url: `${SITE}/guides/${guide.slug}`,
    about: {
      '@type': 'ItemList',
      itemListElement: spots.slice(0, 50).map((s, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${SITE}/spot/${s.slug}`,
        name: s.name,
      })),
    },
  }

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Cafelist', item: SITE },
      { '@type': 'ListItem', position: 2, name: guide.h1, item: `${SITE}/guides/${guide.slug}` },
    ],
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
      <div
        className="sticky top-0 z-20 border-b"
        style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <Link href="/" className="flex items-baseline gap-2 shrink-0">
            <span className="wordmark text-[18px]" style={{ color: 'var(--text-primary)' }}>
              Cafelist
            </span>
          </Link>
          <nav aria-label="Breadcrumb" className="ml-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            <Link href="/" className="hover:opacity-80">Home</Link>
            <span className="mx-1">/</span>
            <span style={{ color: 'var(--text-secondary)' }}>{guide.navLabel}</span>
          </nav>
          <Link
            href="/find"
            className="ml-auto text-[11px] font-medium transition-opacity hover:opacity-80"
            style={{ color: 'var(--accent)' }}
          >
            Find a spot by mood →
          </Link>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-[24px] sm:text-[28px] font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>
          {guide.h1}
        </h1>
        <p className="text-[13px] mt-3 max-w-2xl leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {guide.intro}
        </p>

        {serviceError ? (
          <p className="mt-10 text-sm" style={{ color: 'var(--text-muted)' }}>
            We&apos;re briefly catching up — refresh in a minute.
          </p>
        ) : spots.length === 0 ? (
          <p className="mt-10 text-sm" style={{ color: 'var(--text-muted)' }}>
            Nothing matches this list right now.{' '}
            <Link href="/" className="underline">Browse the full directory</Link> instead.
          </p>
        ) : (
          <>
            <p
              className="text-[11px] uppercase tracking-wider font-medium mt-6 mb-3"
              style={{ color: 'var(--text-muted)' }}
            >
              {spots.length} spot{spots.length === 1 ? '' : 's'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {spots.map((spot) => (
                <SpotCard key={spot.id} spot={spot} />
              ))}
            </div>
          </>
        )}

        <div className="mt-12 pt-6 border-t flex flex-wrap gap-4" style={{ borderColor: 'var(--border-subtle)' }}>
          {GUIDES.filter((g) => g.slug !== guide.slug).map((g) => (
            <Link
              key={g.slug}
              href={`/guides/${g.slug}`}
              className="text-[12px] font-medium transition-opacity hover:opacity-80"
              style={{ color: 'var(--accent)' }}
            >
              {g.h1} →
            </Link>
          ))}
          <Link href="/" className="text-[12px] font-medium transition-opacity hover:opacity-80" style={{ color: 'var(--text-muted)' }}>
            All NYC cafés →
          </Link>
        </div>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd).replace(/</g, '\\u003c') }}
      />
    </div>
  )
}
