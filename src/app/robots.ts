import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/labs', '/api', '/me', '/login', '/auth'],
    },
    sitemap: 'https://cafelist.app/sitemap.xml',
  }
}
