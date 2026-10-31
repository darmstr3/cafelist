// ─────────────────────────────────────────────────────────────
// src/lib/admin/analytics-queries.ts
//
// Data layer for /admin/analytics. Two halves:
//   1. fetchEventRows / getAnalyticsSnapshot — read user_events (and
//      spots for names) with the service-role client, paginated.
//   2. aggregateAnalytics — PURE function over raw rows. No I/O, so it
//      can be unit-tested with hand-made rows.
//
// Volume is small, so everything is aggregated in TypeScript. No SQL
// functions or migrations required. Server-only (service-role key).
// ─────────────────────────────────────────────────────────────

import { supabaseAdmin } from '@/lib/supabase'

// ── Types ────────────────────────────────────────────────────

export type EnvFilter = 'production' | 'preview' | 'development' | 'all'
export type WindowDays = 7 | 30 | 90

export interface EventRow {
  session_id: string | null
  event_type: string
  path: string | null
  spot_id: string | null
  payload: Record<string, unknown> | null
  created_at: string
  user_agent: string | null
}

export interface SpotMeta {
  id: string
  name: string
  neighborhood: string | null
  slug: string | null
}

export interface Totals {
  sessions: number
  pageViews: number
  events: number
  returningSessions: number
  /** Share of sessions (with a known device) that were mobile, 0..1; null if unknown. */
  mobileShare: number | null
}

export interface Delta {
  current: number | null
  previous: number | null
  /** Absolute change; null if either side is null. */
  delta: number | null
  /** Relative change, 0..n; null when previous is 0/null. */
  pct: number | null
}

export interface CountRow {
  label: string
  count: number
}

export interface VenueRow {
  key: string
  spotId: string | null
  name: string
  neighborhood: string | null
  slug: string | null
  views: number
  clicks: number
  total: number
}

export interface NeighborhoodRow {
  neighborhood: string
  cafeViews: number
  filterApplies: number
  total: number
}

export interface SearchRow {
  query: string
  count: number
  avgResults: number | null
}

export interface AnalyticsSnapshot {
  windowDays: number
  env: EnvFilter
  generatedAt: string
  since: string
  totals: Totals
  comparison: {
    previous: Totals
    sessions: Delta
    pageViews: Delta
    events: Delta
    returningSessions: Delta
    mobileShare: Delta
  }
  daily: Array<{ day: string; sessions: number; pageViews: number }>
  acquisition: {
    landingPages: CountRow[]
    referrers: CountRow[]
    utmSources: CountRow[]
    utmCampaigns: CountRow[]
  }
  funnel: Array<{ label: string; sessions: number; pctOfPrevious: number | null; pctOfAll: number | null }>
  topVenues: VenueRow[]
  topNeighborhoods: NeighborhoodRow[]
  searches: {
    total: number
    top: SearchRow[]
    zeroResult: SearchRow[]
  }
  filters: CountRow[]
  directions: {
    total: number
    byProvider: CountRow[]
    byPlacement: CountRow[]
  }
  reviews: { submitted: number; withComment: number }
  nearMe: { searches: number; resultClicks: number }
  dataNotes: Array<{ text: string; href?: string }>
  recent: Array<{ at: string; type: string; path: string | null; slug: string | null }>
  meta: { rowsFetched: number; rowsInWindow: number; botRowsExcluded: number; truncated: boolean }
}

// ── Constants ────────────────────────────────────────────────

/** Same pattern as src/app/api/events/route.ts (server-side bot backstop). */
export const BOT_UA =
  /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|curl|wget|python-requests/i

const DAY_MS = 86_400_000
const PAGE_SIZE = 1000
const MAX_PAGES = 200 // 200k rows safety cap
const TOP_N = 10
const VERCEL_ANALYTICS_URL = 'https://vercel.com/darmstr3s-projects/coffee-list/analytics'

const V2_TYPES = new Set(['cafe_search', 'filter_apply', 'cafe_view', 'directions_click', 'review_submit'])

// ── Small helpers ────────────────────────────────────────────

const nyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** YYYY-MM-DD in America/New_York. */
export function nyDay(d: Date | string | number): string {
  return nyFmt.format(new Date(d))
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function rowEnv(r: EventRow): string {
  return str(r.payload?.env) ?? 'production' // pre-tagging rows are production
}

function bump(m: Map<string, number>, k: string, by = 1) {
  m.set(k, (m.get(k) ?? 0) + by)
}

function toCountRows(m: Map<string, number>, limit = TOP_N): CountRow[] {
  return [...m.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit)
}

function delta(cur: number | null, prev: number | null): Delta {
  if (cur === null || prev === null) return { current: cur, previous: prev, delta: null, pct: null }
  return { current: cur, previous: prev, delta: cur - prev, pct: prev === 0 ? null : (cur - prev) / prev }
}

function computeTotals(rows: EventRow[]): Totals {
  const sessions = new Set<string>()
  const daysBySession = new Map<string, Set<string>>()
  const deviceBySession = new Map<string, string>()
  let pageViews = 0
  for (const r of rows) {
    if (r.event_type === 'page_view') pageViews++
    const sid = r.session_id
    if (!sid) continue
    sessions.add(sid)
    let ds = daysBySession.get(sid)
    if (!ds) daysBySession.set(sid, (ds = new Set()))
    ds.add(nyDay(r.created_at))
    const dev = str(r.payload?.device)
    if (dev && !deviceBySession.has(sid)) deviceBySession.set(sid, dev)
  }
  let returning = 0
  for (const ds of daysBySession.values()) if (ds.size >= 2) returning++
  const known = deviceBySession.size
  let mobile = 0
  for (const d of deviceBySession.values()) if (d === 'mobile') mobile++
  return {
    sessions: sessions.size,
    pageViews,
    events: rows.length,
    returningSessions: returning,
    mobileShare: known === 0 ? null : mobile / known,
  }
}

function sessionsWith(rows: EventRow[], types: Set<string>): Set<string> {
  const s = new Set<string>()
  for (const r of rows) if (r.session_id && types.has(r.event_type)) s.add(r.session_id)
  return s
}

// ── Pure aggregation ─────────────────────────────────────────

export interface AggregateOptions {
  now: Date
  days: WindowDays | number
  env: EnvFilter
}

/**
 * Aggregate raw event rows (may span current + previous window) into a
 * snapshot. Pure: no I/O. `spots` enriches venue names when supplied.
 */
export function aggregateAnalytics(
  allRows: EventRow[],
  opts: AggregateOptions,
  spots: Map<string, SpotMeta> = new Map(),
): AnalyticsSnapshot {
  const { now, days, env } = opts
  const sinceMs = now.getTime() - days * DAY_MS
  const prevSinceMs = sinceMs - days * DAY_MS

  // Bot + env filtering.
  let botExcluded = 0
  const kept: EventRow[] = []
  for (const r of allRows) {
    if (r.user_agent && BOT_UA.test(r.user_agent)) {
      botExcluded++
      continue
    }
    if (env !== 'all' && rowEnv(r) !== env) continue
    kept.push(r)
  }

  const rows: EventRow[] = []
  const prevRows: EventRow[] = []
  for (const r of kept) {
    const t = new Date(r.created_at).getTime()
    if (!Number.isFinite(t)) continue
    if (t >= sinceMs) rows.push(r)
    else if (t >= prevSinceMs) prevRows.push(r)
  }

  const totals = computeTotals(rows)
  const previous = computeTotals(prevRows)

  // Daily series (NY days, zero-filled; walk back from today's NY date).
  const [ty, tm, td] = nyDay(now).split('-').map(Number)
  const dayKeys: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    dayKeys.push(new Date(Date.UTC(ty, tm - 1, td - i)).toISOString().slice(0, 10))
  }
  const daySessions = new Map<string, Set<string>>(dayKeys.map((k) => [k, new Set<string>()]))
  const dayPV = new Map<string, number>(dayKeys.map((k) => [k, 0]))
  for (const r of rows) {
    const k = nyDay(r.created_at)
    if (r.session_id) daySessions.get(k)?.add(r.session_id)
    if (r.event_type === 'page_view' && dayPV.has(k)) dayPV.set(k, (dayPV.get(k) ?? 0) + 1)
  }
  const daily = dayKeys.map((day) => ({
    day,
    sessions: daySessions.get(day)?.size ?? 0,
    pageViews: dayPV.get(day) ?? 0,
  }))

  // Single pass over current-window rows for the event-type breakdowns.
  const landing = new Map<string, number>()
  const referrers = new Map<string, number>()
  const utmSource = new Map<string, number>()
  const utmCampaign = new Map<string, number>()
  const venues = new Map<string, VenueRow>()
  const hoods = new Map<string, NeighborhoodRow>()
  const searchAgg = new Map<string, { count: number; resSum: number; resN: number }>()
  const filterCounts = new Map<string, number>()
  const provider = new Map<string, number>()
  const placement = new Map<string, number>()
  let directionsTotal = 0
  let reviews = 0
  let reviewsWithComment = 0
  let nearSearch = 0
  let nearClick = 0
  let v2Rows = 0

  const venueFor = (r: EventRow): VenueRow | null => {
    const slug = str(r.payload?.slug)
    const key = r.spot_id ?? (slug ? `slug:${slug}` : null)
    if (!key) return null
    let v = venues.get(key)
    if (!v) {
      const meta = r.spot_id ? spots.get(r.spot_id) : undefined
      v = {
        key,
        spotId: r.spot_id,
        name: meta?.name ?? slug ?? 'Unknown venue',
        neighborhood: meta?.neighborhood ?? null,
        slug: meta?.slug ?? slug,
        views: 0,
        clicks: 0,
        total: 0,
      }
      venues.set(key, v)
    }
    return v
  }
  const hoodFor = (name: string): NeighborhoodRow => {
    let h = hoods.get(name)
    if (!h) hoods.set(name, (h = { neighborhood: name, cafeViews: 0, filterApplies: 0, total: 0 }))
    return h
  }

  for (const r of rows) {
    const p = r.payload ?? {}
    if (V2_TYPES.has(r.event_type)) v2Rows++
    switch (r.event_type) {
      case 'page_view': {
        if (p.landing) {
          bump(landing, r.path ?? '(unknown)')
          bump(referrers, str(p.ref) ?? 'direct / unknown')
          const us = str(p.utm_source)
          if (us) bump(utmSource, us)
          const uc = str(p.utm_campaign)
          if (uc) bump(utmCampaign, uc)
        }
        break
      }
      case 'cafe_view': {
        const v = venueFor(r)
        if (v) {
          v.views++
          v.total++
        }
        const n = str(p.neighborhood)
        if (n) {
          const h = hoodFor(n)
          h.cafeViews++
          h.total++
        }
        break
      }
      case 'spot_click': {
        const v = venueFor(r)
        if (v) {
          v.clicks++
          v.total++
        }
        break
      }
      case 'filter_apply': {
        const n = str(p.neighborhood)
        if (n) {
          const h = hoodFor(n)
          h.filterApplies++
          h.total++
        }
        if (Array.isArray(p.changed)) {
          for (const c of p.changed) {
            const k = str(c)
            if (k) bump(filterCounts, k)
          }
        }
        break
      }
      case 'cafe_search': {
        const q = str(p.query)?.toLowerCase()
        if (!q) break
        const a = searchAgg.get(q) ?? { count: 0, resSum: 0, resN: 0 }
        a.count++
        const rc = num(p.result_count)
        if (rc !== null) {
          a.resSum += rc
          a.resN++
        }
        searchAgg.set(q, a)
        break
      }
      case 'directions_click': {
        directionsTotal++
        bump(provider, str(p.provider) ?? 'unknown')
        bump(placement, str(p.placement) ?? 'unknown')
        break
      }
      case 'review_submit': {
        reviews++
        if (p.has_comment === true) reviewsWithComment++
        break
      }
      case 'near_me_search':
        nearSearch++
        break
      case 'near_me_result_click':
        nearClick++
        break
    }
  }

  // Searches: zero-result = queries whose reported result_count was 0 at least once.
  const zeroCounts = new Map<string, number>()
  for (const r of rows) {
    if (r.event_type !== 'cafe_search') continue
    const q = str(r.payload?.query)?.toLowerCase()
    if (q && num(r.payload?.result_count) === 0) bump(zeroCounts, q)
  }
  const searchRows: SearchRow[] = [...searchAgg.entries()].map(([query, a]) => ({
    query,
    count: a.count,
    avgResults: a.resN === 0 ? null : a.resSum / a.resN,
  }))
  const byCount = (a: SearchRow, b: SearchRow) => b.count - a.count || a.query.localeCompare(b.query)
  const zeroResult: SearchRow[] = [...zeroCounts.entries()]
    .map(([query, count]) => ({ query, count, avgResults: 0 }))
    .sort(byCount)
    .slice(0, TOP_N)

  // Funnel.
  const engaged = sessionsWith(rows, new Set(['cafe_view', 'spot_click']))
  const dirSessions = sessionsWith(rows, new Set(['directions_click']))
  const pct = (a: number, b: number) => (b === 0 ? null : a / b)
  const funnel = [
    { label: 'Sessions', sessions: totals.sessions, pctOfPrevious: null as number | null, pctOfAll: pct(totals.sessions, totals.sessions) },
    { label: 'Viewed or clicked a café', sessions: engaged.size, pctOfPrevious: pct(engaged.size, totals.sessions), pctOfAll: pct(engaged.size, totals.sessions) },
    { label: 'Clicked directions', sessions: dirSessions.size, pctOfPrevious: pct(dirSessions.size, engaged.size), pctOfAll: pct(dirSessions.size, totals.sessions) },
  ]

  // Data notes.
  const dataNotes: AnalyticsSnapshot['dataNotes'] = []
  if (rows.length === 0) {
    dataNotes.push({ text: 'No events in this window with the current filters. Try a longer window or env=all.' })
  } else if (v2Rows === 0) {
    dataNotes.push({
      text: 'No taxonomy v2 events (cafe_search, filter_apply, cafe_view, directions_click, review_submit) in this window. They only exist after migration 20261031_user_events_taxonomy is applied and the new client code is deployed.',
    })
  }
  if (env === 'production') {
    dataNotes.push({ text: 'Rows written before env tagging have no payload.env and are counted as production.' })
  }
  if (botExcluded > 0) {
    dataNotes.push({ text: `${botExcluded} row(s) with bot-like user agents were excluded.` })
  }
  dataNotes.push({ text: 'A session is one browser (localStorage session id), so it can span days; "returning" means active on 2+ distinct New York days in the window.' })
  dataNotes.push({ text: 'Directions click is not a café visit: it only means someone tapped a maps link.' })
  dataNotes.push({
    text: 'Vercel Web Analytics (pageviews, referrers, countries) lives in the Vercel dashboard.',
    href: VERCEL_ANALYTICS_URL,
  })

  // Recent events (current window, newest first).
  const recent = [...rows]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 25)
    .map((r) => ({
      at: r.created_at,
      type: r.event_type,
      path: r.path,
      slug: str(r.payload?.slug) ?? (r.spot_id ? spots.get(r.spot_id)?.slug ?? null : null),
    }))

  return {
    windowDays: days,
    env,
    generatedAt: now.toISOString(),
    since: new Date(sinceMs).toISOString(),
    totals,
    comparison: {
      previous,
      sessions: delta(totals.sessions, previous.sessions),
      pageViews: delta(totals.pageViews, previous.pageViews),
      events: delta(totals.events, previous.events),
      returningSessions: delta(totals.returningSessions, previous.returningSessions),
      mobileShare: delta(totals.mobileShare, previous.mobileShare),
    },
    daily,
    acquisition: {
      landingPages: toCountRows(landing),
      referrers: toCountRows(referrers),
      utmSources: toCountRows(utmSource),
      utmCampaigns: toCountRows(utmCampaign),
    },
    funnel,
    topVenues: [...venues.values()]
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
      .slice(0, TOP_N),
    topNeighborhoods: [...hoods.values()]
      .sort((a, b) => b.total - a.total || a.neighborhood.localeCompare(b.neighborhood))
      .slice(0, TOP_N),
    searches: {
      total: searchRows.reduce((s, r) => s + r.count, 0),
      top: searchRows.sort(byCount).slice(0, TOP_N),
      zeroResult,
    },
    filters: toCountRows(filterCounts),
    directions: { total: directionsTotal, byProvider: toCountRows(provider), byPlacement: toCountRows(placement) },
    reviews: { submitted: reviews, withComment: reviewsWithComment },
    nearMe: { searches: nearSearch, resultClicks: nearClick },
    dataNotes,
    recent,
    meta: {
      rowsFetched: allRows.length,
      rowsInWindow: rows.length,
      botRowsExcluded: botExcluded,
      truncated: false,
    },
  }
}

// ── Fetching ─────────────────────────────────────────────────

async function fetchEventRows(sinceIso: string): Promise<{ rows: EventRow[]; truncated: boolean }> {
  const rows: EventRow[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE
    const { data, error } = await supabaseAdmin
      .from('user_events')
      .select('session_id,event_type,path,spot_id,payload,created_at,user_agent')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`user_events query failed: ${error.message}`)
    const chunk = (data ?? []) as EventRow[]
    rows.push(...chunk)
    if (chunk.length < PAGE_SIZE) return { rows, truncated: false }
  }
  return { rows, truncated: true }
}

async function fetchSpotMeta(ids: string[]): Promise<Map<string, SpotMeta>> {
  const out = new Map<string, SpotMeta>()
  if (ids.length === 0) return out
  const { data, error } = await supabaseAdmin
    .from('spots')
    .select('id,name,neighborhood,slug')
    .in('id', ids)
  if (error) throw new Error(`spots query failed: ${error.message}`)
  for (const s of (data ?? []) as SpotMeta[]) out.set(s.id, s)
  return out
}

/** Fetch + aggregate. Throws on Supabase errors; the page catches. */
export async function getAnalyticsSnapshot(days: WindowDays, env: EnvFilter): Promise<AnalyticsSnapshot> {
  const now = new Date()
  // Two windows back, so the comparison period is available.
  const since = new Date(now.getTime() - 2 * days * DAY_MS).toISOString()
  const { rows, truncated } = await fetchEventRows(since)

  const first = aggregateAnalytics(rows, { now, days, env })
  const ids = first.topVenues.map((v) => v.spotId).filter((x): x is string => !!x)
  const spots = await fetchSpotMeta(ids)
  const snap = aggregateAnalytics(rows, { now, days, env }, spots)
  snap.meta.truncated = truncated
  if (truncated) {
    snap.dataNotes.unshift({
      text: `Row cap reached (${MAX_PAGES * PAGE_SIZE} rows fetched); older rows were not read, so totals and the previous-period comparison are undercounted.`,
    })
  }
  return snap
}
