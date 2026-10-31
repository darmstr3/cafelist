// ─────────────────────────────────────────────────────────────
// /admin/analytics — read-only product analytics for cafelist.
//
// Server component. Reads user_events via the service-role client
// (see src/lib/admin/analytics-queries.ts), aggregates in TypeScript,
// and renders tables + inline bars. Gated by the /admin Basic Auth
// middleware. Never throws on query errors; renders an error card.
// ─────────────────────────────────────────────────────────────

import Link from 'next/link'
import { AlertCircle, BarChart3, ChevronLeft, ExternalLink, Info } from 'lucide-react'
import {
  getAnalyticsSnapshot,
  type AnalyticsSnapshot,
  type CountRow,
  type Delta,
  type EnvFilter,
  type WindowDays,
} from '@/lib/admin/analytics-queries'

export const metadata = {
  title: 'Analytics — Cafelist',
  description: 'Read-only product analytics for Cafelist.',
  robots: { index: false },
}

export const dynamic = 'force-dynamic'

const DAY_OPTIONS: WindowDays[] = [7, 30, 90]
const ENV_OPTIONS: EnvFilter[] = ['production', 'preview', 'development', 'all']

function parseDays(v: string | string[] | undefined): WindowDays {
  const n = Number(Array.isArray(v) ? v[0] : v)
  return n === 7 || n === 90 ? n : 30
}
function parseEnv(v: string | string[] | undefined): EnvFilter {
  const s = Array.isArray(v) ? v[0] : v
  return s === 'preview' || s === 'development' || s === 'all' ? s : 'production'
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams
  const days = parseDays(sp.days)
  const env = parseEnv(sp.env)

  let snap: AnalyticsSnapshot | null = null
  let error: string | null = null
  try {
    snap = await getAnalyticsSnapshot(days, env)
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unknown error'
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
      <div
        className="sticky top-0 z-20 border-b"
        style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <Link
            href="/admin/ops"
            className="inline-flex items-center gap-1 text-xs font-medium transition-opacity hover:opacity-70"
            style={{ color: 'var(--text-muted)' }}
          >
            <ChevronLeft size={13} />
            Agent ops
          </Link>
          <span className="ml-auto wordmark text-[15px] flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <span>Cafelist</span>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide"
              style={{ backgroundColor: 'var(--accent-glow)', color: 'var(--accent)' }}
            >
              Analytics
            </span>
          </span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <header className="space-y-3">
          <h1
            className="text-2xl sm:text-3xl font-semibold tracking-tight"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-fraunces)' }}
          >
            Product analytics
          </h1>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Toggle
              label="Window"
              options={DAY_OPTIONS.map((d) => ({ value: String(d), text: `${d}d`, href: href(d, env), active: d === days }))}
            />
            <Toggle
              label="Env"
              options={ENV_OPTIONS.map((e) => ({ value: e, text: e, href: href(days, e), active: e === env }))}
            />
          </div>
        </header>

        {error || !snap ? (
          <Card title="Could not load analytics" icon={<AlertCircle size={16} />}>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              The events query failed, so nothing is shown rather than guessing numbers.
            </p>
            <pre
              className="mt-3 text-xs p-3 rounded overflow-x-auto"
              style={{ backgroundColor: 'var(--surface-2, var(--background))', color: 'var(--text-muted)' }}
            >
              {error}
            </pre>
          </Card>
        ) : (
          <Dashboard snap={snap} />
        )}
      </div>
    </div>
  )
}

function href(days: number, env: string): string {
  return `/admin/analytics?days=${days}&env=${env}`
}

// ── Dashboard ────────────────────────────────────────────────

function Dashboard({ snap }: { snap: AnalyticsSnapshot }) {
  const t = snap.totals
  const c = snap.comparison
  const maxDaily = Math.max(1, ...snap.daily.map((d) => d.sessions))

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat label="Sessions" value={fmt(t.sessions)} d={c.sessions} />
        <Stat label="Page views" value={fmt(t.pageViews)} d={c.pageViews} />
        <Stat label="Events" value={fmt(t.events)} d={c.events} />
        <Stat label="Returning sessions" value={fmt(t.returningSessions)} d={c.returningSessions} />
        <Stat
          label="Mobile share"
          value={t.mobileShare === null ? 'n/a' : pctStr(t.mobileShare)}
          d={c.mobileShare}
          isShare
        />
      </div>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Last {snap.windowDays} days vs the previous {snap.windowDays} days. {fmt(snap.meta.rowsInWindow)} events in
        window.
      </p>

      <Card title="Daily sessions" subtitle="America/New_York days">
        {snap.totals.events === 0 ? (
          <Empty text="No events in this window." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: 'var(--text-muted)' }}>
                  <Th>Day</Th>
                  <Th right>Sessions</Th>
                  <Th right>Page views</Th>
                  <Th>&nbsp;</Th>
                </tr>
              </thead>
              <tbody>
                {[...snap.daily].reverse().map((d) => (
                  <tr key={d.day} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <Td>{d.day}</Td>
                    <Td right>{d.sessions}</Td>
                    <Td right>{d.pageViews}</Td>
                    <Td w="45%">
                      <Bar value={d.sessions} max={maxDaily} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Funnel (session-based)" subtitle="Directions click ≠ a café visit">
          {t.sessions === 0 ? (
            <Empty text="No sessions yet." />
          ) : (
            <ul className="space-y-3">
              {snap.funnel.map((f) => (
                <li key={f.label}>
                  <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-primary)' }}>
                    <span>{f.label}</span>
                    <span>
                      {fmt(f.sessions)}
                      {f.pctOfPrevious !== null && (
                        <span style={{ color: 'var(--text-muted)' }}> · {pctStr(f.pctOfPrevious)} of previous step</span>
                      )}
                    </span>
                  </div>
                  <Bar value={f.sessions} max={Math.max(1, snap.funnel[0].sessions)} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Acquisition: landing pages" subtitle="First page of a visit">
          <CountTable rows={snap.acquisition.landingPages} empty="No landing page views recorded." />
        </Card>

        <Card title="Referrers" subtitle="Landing page views only">
          <CountTable rows={snap.acquisition.referrers} empty="No landing page views recorded." />
        </Card>

        <Card title="UTM" subtitle="utm_source and utm_campaign on landing">
          {snap.acquisition.utmSources.length === 0 && snap.acquisition.utmCampaigns.length === 0 ? (
            <Empty text="No UTM-tagged visits." />
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Sub>Source</Sub>
                <CountTable rows={snap.acquisition.utmSources} empty="None." />
              </div>
              <div>
                <Sub>Campaign</Sub>
                <CountTable rows={snap.acquisition.utmCampaigns} empty="None." />
              </div>
            </div>
          )}
        </Card>

        <Card title="Top venues" subtitle="cafe_view + spot_click">
          {snap.topVenues.length === 0 ? (
            <Empty text="No café views or clicks." />
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: 'var(--text-muted)' }}>
                  <Th>Venue</Th>
                  <Th right>Views</Th>
                  <Th right>Clicks</Th>
                  <Th right>Total</Th>
                </tr>
              </thead>
              <tbody>
                {snap.topVenues.map((v) => (
                  <tr key={v.key} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <Td>
                      <span style={{ color: 'var(--text-primary)' }}>{v.name}</span>
                      {v.neighborhood && <span style={{ color: 'var(--text-muted)' }}> · {v.neighborhood}</span>}
                    </Td>
                    <Td right>{v.views}</Td>
                    <Td right>{v.clicks}</Td>
                    <Td right>{v.total}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Top neighborhoods" subtitle="café views + filter applies">
          {snap.topNeighborhoods.length === 0 ? (
            <Empty text="No neighborhood data." />
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: 'var(--text-muted)' }}>
                  <Th>Neighborhood</Th>
                  <Th right>Views</Th>
                  <Th right>Filters</Th>
                  <Th right>Total</Th>
                </tr>
              </thead>
              <tbody>
                {snap.topNeighborhoods.map((n) => (
                  <tr key={n.neighborhood} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <Td>{n.neighborhood}</Td>
                    <Td right>{n.cafeViews}</Td>
                    <Td right>{n.filterApplies}</Td>
                    <Td right>{n.total}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Top searches" subtitle={`${fmt(snap.searches.total)} searches`}>
          {snap.searches.top.length === 0 ? (
            <Empty text="No searches recorded." />
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: 'var(--text-muted)' }}>
                  <Th>Query</Th>
                  <Th right>Count</Th>
                  <Th right>Avg results</Th>
                </tr>
              </thead>
              <tbody>
                {snap.searches.top.map((s) => (
                  <tr key={s.query} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <Td>{s.query}</Td>
                    <Td right>{s.count}</Td>
                    <Td right>{s.avgResults === null ? 'n/a' : s.avgResults.toFixed(1)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Zero-result searches" subtitle="Demand signals for coverage gaps">
          {snap.searches.zeroResult.length === 0 ? (
            <Empty text="No zero-result searches." />
          ) : (
            <CountTable rows={snap.searches.zeroResult.map((s) => ({ label: s.query, count: s.count }))} empty="" />
          )}
        </Card>

        <Card title="Filter usage" subtitle="Count by changed filter">
          <CountTable rows={snap.filters} empty="No filters applied." />
        </Card>

        <Card title="Directions clicks" subtitle={`${fmt(snap.directions.total)} total · not a confirmed visit`}>
          {snap.directions.total === 0 ? (
            <Empty text="No directions clicks." />
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Sub>Provider</Sub>
                <CountTable rows={snap.directions.byProvider} empty="None." />
              </div>
              <div>
                <Sub>Placement</Sub>
                <CountTable rows={snap.directions.byPlacement} empty="None." />
              </div>
            </div>
          )}
        </Card>

        <Card title="Reviews and near-me">
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <KV k="Reviews submitted" v={snap.reviews.submitted} />
            <KV k="...with a comment" v={snap.reviews.withComment} />
            <KV k="Near-me searches (legacy)" v={snap.nearMe.searches} />
            <KV k="Near-me result clicks (legacy)" v={snap.nearMe.resultClicks} />
          </dl>
        </Card>
      </div>

      <Card title="Data notes" icon={<Info size={16} />}>
        <ul className="space-y-2 text-xs list-disc pl-4" style={{ color: 'var(--text-secondary)' }}>
          {snap.dataNotes.map((n, i) => (
            <li key={i}>
              {n.text}
              {n.href && (
                <>
                  {' '}
                  <a
                    href={n.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 underline"
                    style={{ color: 'var(--accent)' }}
                  >
                    Open <ExternalLink size={10} />
                  </a>
                </>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Recent events" subtitle="Last 25 (no user agent or user id)">
        {snap.recent.length === 0 ? (
          <Empty text="No events." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: 'var(--text-muted)' }}>
                  <Th>Time (ET)</Th>
                  <Th>Type</Th>
                  <Th>Path</Th>
                  <Th>Slug</Th>
                </tr>
              </thead>
              <tbody>
                {snap.recent.map((r, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <Td>{fmtTime(r.at)}</Td>
                    <Td>{r.type}</Td>
                    <Td>{r.path ?? ''}</Td>
                    <Td>{r.slug ?? ''}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}

// ── Presentational helpers ───────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString('en-US')
}
function pctStr(x: number): string {
  return `${Math.round(x * 1000) / 10}%`
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function Toggle({
  label,
  options,
}: {
  label: string
  options: Array<{ value: string; text: string; href: string; active: boolean }>
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <div className="inline-flex rounded border overflow-hidden" style={{ borderColor: 'var(--border-subtle)' }}>
        {options.map((o) => (
          <Link
            key={o.value}
            href={o.href}
            className="px-2.5 py-1 transition-opacity hover:opacity-80"
            aria-current={o.active ? 'page' : undefined}
            style={{
              backgroundColor: o.active ? 'var(--accent-glow)' : 'transparent',
              color: o.active ? 'var(--accent)' : 'var(--text-primary)',
              fontWeight: o.active ? 600 : 400,
            }}
          >
            {o.text}
          </Link>
        ))}
      </div>
    </div>
  )
}

function Card({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string
  subtitle?: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section
      className="rounded-lg border p-5"
      style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface-1)' }}
    >
      <div className="flex items-start gap-3 mb-4">
        <div
          className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
          style={{ backgroundColor: 'var(--accent-glow)', color: 'var(--accent)' }}
        >
          {icon ?? <BarChart3 size={16} />}
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-medium leading-tight" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h2>
          {subtitle && (
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {children}
    </section>
  )
}

function Stat({ label, value, d, isShare }: { label: string; value: string; d: Delta; isShare?: boolean }) {
  let note = 'no prior data'
  if (d.delta !== null) {
    if (isShare) {
      const pts = Math.round(d.delta * 1000) / 10
      note = `${pts > 0 ? '+' : ''}${pts} pts vs prev`
    } else if (d.pct === null) {
      note = d.delta === 0 ? 'flat vs prev' : `${d.delta > 0 ? '+' : ''}${d.delta} vs prev (prev 0)`
    } else {
      note = `${d.delta > 0 ? '+' : ''}${Math.round(d.pct * 100)}% vs prev (${fmt(d.previous ?? 0)})`
    }
  }
  return (
    <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface-1)' }}>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        {label}
      </div>
      <div className="text-2xl font-semibold mt-1" style={{ color: 'var(--text-primary)' }}>
        {value}
      </div>
      <div className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
        {note}
      </div>
    </div>
  )
}

function Bar({ value, max }: { value: number; max: number }) {
  const w = max === 0 ? 0 : Math.max(value > 0 ? 2 : 0, Math.round((value / max) * 100))
  return (
    <div className="h-2 rounded" style={{ backgroundColor: 'var(--border-subtle)' }}>
      <div className="h-2 rounded" style={{ width: `${w}%`, backgroundColor: 'var(--accent)' }} />
    </div>
  )
}

function CountTable({ rows, empty }: { rows: CountRow[]; empty: string }) {
  if (rows.length === 0) return <Empty text={empty} />
  const max = Math.max(...rows.map((r) => r.count))
  return (
    <table className="w-full text-xs">
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-t first:border-t-0" style={{ borderColor: 'var(--border-subtle)' }}>
            <Td>{r.label}</Td>
            <Td right>{r.count}</Td>
            <Td w="30%">
              <Bar value={r.count} max={max} />
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function KV({ k, v }: { k: string; v: number }) {
  return (
    <div>
      <dt style={{ color: 'var(--text-muted)' }}>{k}</dt>
      <dd className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
        {fmt(v)}
      </dd>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
      {text}
    </p>
  )
}

function Sub({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>
      {children}
    </div>
  )
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return <th className={`py-1.5 font-medium ${right ? 'text-right' : 'text-left'} pr-2`}>{children}</th>
}

function Td({ children, right, w }: { children?: React.ReactNode; right?: boolean; w?: string }) {
  return (
    <td
      className={`py-1.5 pr-2 ${right ? 'text-right tabular-nums' : 'text-left'}`}
      style={{ color: 'var(--text-secondary)', width: w }}
    >
      {children}
    </td>
  )
}
