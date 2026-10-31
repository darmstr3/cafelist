'use client'

/**
 * Vercel Web Analytics — pageviews, referrers, country, device.
 * Inert until Web Analytics is enabled in the Vercel dashboard.
 * /admin and /labs are dropped so Donovan's own usage doesn't skew counts.
 */
import { Analytics } from '@vercel/analytics/next'

export function WebAnalytics() {
  return (
    <Analytics
      beforeSend={(event) =>
        /\/(admin|labs)(\/|$)/.test(new URL(event.url).pathname) ? null : event
      }
    />
  )
}
