// ─────────────────────────────────────────────────────────────
// src/lib/admin/status-queries.ts
//
// Data for /admin/status — the "mission control" dashboard that
// answers "is everything OK" in one glance: business/data health,
// a condensed agent summary, tech-stack configuration + reachability,
// and SEO surface health.
//
// Same conventions as ops-queries.ts: server-only (service-role
// client), every helper has a non-throwing fallback so one bad query
// can't take the whole page down.
// ─────────────────────────────────────────────────────────────

import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase'
import pkg from '../../../package.json'

// ── Business pulse (the data-quality audit, turned into live metrics) ──

export interface BusinessPulse {
  configured: boolean
  counts: { approved: number; pending: number; rejected: number }
  dataConfidence: { verified: number; inferred: number; unknown: number }
  lastSpotCreated: string | null
  lastAdminApproval: string | null
  lastWorkabilityScore: string | null
  pipelineDormantDays: number | null
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000))
}

export async function getBusinessPulse(): Promise<BusinessPulse> {
  const empty: BusinessPulse = {
    configured: isSupabaseConfigured(),
    counts: { approved: 0, pending: 0, rejected: 0 },
    dataConfidence: { verified: 0, inferred: 0, unknown: 0 },
    lastSpotCreated: null,
    lastAdminApproval: null,
    lastWorkabilityScore: null,
    pipelineDormantDays: null,
  }
  if (!isSupabaseConfigured()) return empty

  const [statusRes, confRes, lastCreatedRes, lastApprovedRes, lastScoredRes] =
    await Promise.all([
      supabaseAdmin.from('spots').select('status'),
      supabaseAdmin
        .from('spots')
        .select('data_confidence')
        .eq('status', 'approved'),
      supabaseAdmin
        .from('spots')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from('spots')
        .select('last_verified_at')
        .not('last_verified_at', 'is', null)
        .order('last_verified_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from('spots')
        .select('workability_scored_at')
        .not('workability_scored_at', 'is', null)
        .order('workability_scored_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

  const statusRows = (statusRes.data ?? []) as Array<{ status: string }>
  const counts = { approved: 0, pending: 0, rejected: 0 }
  for (const r of statusRows) {
    if (r.status === 'approved') counts.approved++
    else if (r.status === 'pending') counts.pending++
    else if (r.status === 'rejected') counts.rejected++
  }

  const confRows = (confRes.data ?? []) as Array<{ data_confidence: string | null }>
  const dataConfidence = { verified: 0, inferred: 0, unknown: 0 }
  for (const r of confRows) {
    if (r.data_confidence === 'verified') dataConfidence.verified++
    else if (r.data_confidence === 'inferred') dataConfidence.inferred++
    else dataConfidence.unknown++
  }

  const lastSpotCreated =
    (lastCreatedRes.data as { created_at: string } | null)?.created_at ?? null
  const lastAdminApproval =
    (lastApprovedRes.data as { last_verified_at: string } | null)
      ?.last_verified_at ?? null
  const lastWorkabilityScore =
    (lastScoredRes.data as { workability_scored_at: string } | null)
      ?.workability_scored_at ?? null

  // "Dormant" = oldest of the three signals, since a pipeline is only as
  // alive as its stalest stage.
  const stalest = [lastSpotCreated, lastAdminApproval, lastWorkabilityScore]
    .map((d) => daysSince(d))
    .filter((d): d is number => d != null)
  const pipelineDormantDays = stalest.length > 0 ? Math.min(...stalest) : null

  return {
    configured: true,
    counts,
    dataConfidence,
    lastSpotCreated,
    lastAdminApproval,
    lastWorkabilityScore,
    pipelineDormantDays,
  }
}

// ── Tech stack & infra ───────────────────────────────────────

export interface EnvCheck {
  name: string
  set: boolean
  note: string
}

export interface TechStackSnapshot {
  // Static — read from package.json, never changes without a deploy.
  framework: { name: string; version: string }
  runtime: { name: string; version: string }[]
  // Live — did the request to Supabase actually succeed just now.
  supabaseReachable: boolean
  supabaseLatencyMs: number | null
  envChecks: EnvCheck[]
}

const ENV_CHECKS: Array<{ name: string; env: string; note: string }> = [
  { name: 'Supabase URL', env: 'NEXT_PUBLIC_SUPABASE_URL', note: 'DB connection' },
  { name: 'Supabase service role', env: 'SUPABASE_SERVICE_ROLE_KEY', note: 'server-side writes' },
  { name: 'Google Places API', env: 'GOOGLE_PLACES_API_KEY', note: 'Scout discovery + enrichment' },
  { name: 'Anthropic API', env: 'ANTHROPIC_API_KEY', note: 'Curator + /labs' },
  { name: 'Scout cron secret', env: 'SCOUT_CRON_SECRET', note: 'authenticates /api/scout' },
  { name: 'Curator cron secret', env: 'CURATOR_CRON_SECRET', note: 'authenticates /api/curate (falls back to CRON_SECRET)' },
  { name: 'Vercel cron secret', env: 'CRON_SECRET', note: 'auto-injected by Vercel Cron — shared by Scout + Curator' },
  { name: 'Admin password', env: 'ADMIN_PASSWORD', note: 'gates /admin/* — this page' },
  { name: 'Site URL', env: 'NEXT_PUBLIC_SITE_URL', note: 'used by server actions to call back into the app' },
]

export async function getTechStackSnapshot(): Promise<TechStackSnapshot> {
  const envChecks: EnvCheck[] = ENV_CHECKS.map((c) => ({
    name: c.name,
    set: !!process.env[c.env],
    note: c.note,
  }))

  let supabaseReachable = false
  let supabaseLatencyMs: number | null = null
  if (isSupabaseConfigured()) {
    const start = Date.now()
    try {
      const { error } = await supabaseAdmin
        .from('spots')
        .select('id', { count: 'exact', head: true })
        .limit(1)
      supabaseReachable = !error
      supabaseLatencyMs = Date.now() - start
    } catch {
      supabaseReachable = false
    }
  }

  return {
    framework: { name: 'Next.js', version: pkg.dependencies.next },
    runtime: [
      { name: 'React', version: pkg.dependencies.react },
      { name: 'Supabase JS', version: pkg.dependencies['@supabase/supabase-js'] },
      { name: 'Anthropic SDK', version: pkg.dependencies['@anthropic-ai/sdk'] },
      { name: 'Tailwind CSS', version: pkg.devDependencies.tailwindcss },
    ],
    supabaseReachable,
    supabaseLatencyMs,
    envChecks,
  }
}

// ── SEO surface ───────────────────────────────────────────────

export interface SeoSnapshot {
  configured: boolean
  publicSpotPages: number
  spotPagesMissingNeighborhood: number
  sitemapStaticPages: number
  robotsAllowsIndexing: boolean
  robotsDisallowedPaths: string[]
  siteUrl: string
}

export async function getSeoSnapshot(): Promise<SeoSnapshot> {
  const empty: SeoSnapshot = {
    configured: isSupabaseConfigured(),
    publicSpotPages: 0,
    spotPagesMissingNeighborhood: 0,
    sitemapStaticPages: 4, // '', /find, /near-me, /submit — see src/app/sitemap.ts
    robotsAllowsIndexing: true,
    robotsDisallowedPaths: ['/admin', '/labs', '/api', '/me', '/login', '/auth'],
    siteUrl: 'https://cafelist.app',
  }
  if (!isSupabaseConfigured()) return empty

  const { data } = await supabaseAdmin
    .from('spots')
    .select('slug, neighborhood')
    .eq('status', 'approved')

  const rows = (data ?? []) as Array<{ slug: string | null; neighborhood: string | null }>
  const withSlug = rows.filter((r) => r.slug)

  return {
    ...empty,
    publicSpotPages: withSlug.length,
    spotPagesMissingNeighborhood: withSlug.filter((r) => !r.neighborhood).length,
  }
}

// ── Aggregator ────────────────────────────────────────────────

export interface StatusSnapshot {
  business: BusinessPulse
  techStack: TechStackSnapshot
  seo: SeoSnapshot
  fetchedAt: string
}

export async function getStatusSnapshot(): Promise<StatusSnapshot> {
  const [business, techStack, seo] = await Promise.all([
    getBusinessPulse().catch(
      (): BusinessPulse => ({
        configured: false,
        counts: { approved: 0, pending: 0, rejected: 0 },
        dataConfidence: { verified: 0, inferred: 0, unknown: 0 },
        lastSpotCreated: null,
        lastAdminApproval: null,
        lastWorkabilityScore: null,
        pipelineDormantDays: null,
      }),
    ),
    getTechStackSnapshot(),
    getSeoSnapshot().catch(
      (): SeoSnapshot => ({
        configured: false,
        publicSpotPages: 0,
        spotPagesMissingNeighborhood: 0,
        sitemapStaticPages: 4,
        robotsAllowsIndexing: true,
        robotsDisallowedPaths: [],
        siteUrl: 'https://cafelist.app',
      }),
    ),
  ])

  return { business, techStack, seo, fetchedAt: new Date().toISOString() }
}
