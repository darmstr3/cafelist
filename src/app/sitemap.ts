import type { MetadataRoute } from 'next'
import { getSpots } from '@/lib/spots'
import { GUIDES } from '@/lib/guides'

const SITE = 'https://cafelist.app'

// Regenerate at most hourly instead of on every crawler request.
export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { spots, serviceError } = await getSpots()
  // If the data source failed, throw so the previously cached sitemap keeps
  // being served rather than caching a sitemap with no venue pages for an hour.
  if (serviceError) throw new Error('sitemap: spots unavailable')

  const staticPages: MetadataRoute.Sitemap = ['', '/find', '/near-me', '/submit'].map((path) => ({
    url: `${SITE}${path}`,
    changeFrequency: 'weekly',
    priority: path === '' ? 1 : 0.6,
  }))

  // Landing pages built for the 2026-11 growth push — see lib/guides.ts.
  const guidePages: MetadataRoute.Sitemap = GUIDES.map((g) => ({
    url: `${SITE}/guides/${g.slug}`,
    changeFrequency: 'weekly',
    priority: 0.7,
  }))

  const spotPages: MetadataRoute.Sitemap = spots
    .filter((s) => s.slug)
    .map((s) => ({
      url: `${SITE}/spot/${s.slug}`,
      lastModified: s.updated_at ? new Date(s.updated_at) : undefined,
      changeFrequency: 'weekly',
      priority: 0.8,
    }))

  return [...staticPages, ...guidePages, ...spotPages]
}
