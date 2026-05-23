'use client'

import { useMemo, useState } from 'react'
import { Spot, Review, SpotStatus, ReviewStatus } from '@/types'
import type { ScoutRunRow } from '@/lib/spots'
import { formatHoursDisplay, typeLabel } from '@/lib/utils'
import { Check, X, MapPin, Clock, Eye, Download, RefreshCw, AlertCircle, CheckCircle2, Pencil, Telescope } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { SpotEditPanel } from './SpotEditPanel'

interface AdminDashboardProps {
  initialSpots: Spot[]
  initialReviews: (Review & { spot_name?: string })[]
  initialScoutRuns?: ScoutRunRow[]
}

type Tab = 'spots' | 'reviews' | 'import' | 'scout'
type SpotFilter = 'all' | SpotStatus
type ReviewFilter = 'all' | ReviewStatus

async function updateSpotStatus(id: string, status: 'approved' | 'rejected') {
  await fetch(`/api/spots/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
}

async function updateReviewStatus(id: string, status: 'approved' | 'rejected') {
  await fetch(`/api/reviews/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; color: string }> = {
    pending:  { bg: 'rgba(198,133,18,0.12)', color: 'var(--kinda)' },
    approved: { bg: 'rgba(47,125,79,0.12)', color: 'var(--yes)' },
    rejected: { bg: 'rgba(168,57,47,0.12)',  color: 'var(--no)' },
  }
  const s = styles[status] ?? styles.pending
  return (
    <span
      className="text-[11px] font-medium px-2 py-0.5 rounded-full"
      style={{ backgroundColor: s.bg, color: s.color }}
    >
      {status}
    </span>
  )
}

export function AdminDashboard({ initialSpots, initialReviews, initialScoutRuns = [] }: AdminDashboardProps) {
  const [tab, setTab] = useState<Tab>('spots')

  // Import state
  const [importLimit, setImportLimit] = useState(60)
  const [importState, setImportState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [importResult, setImportResult] = useState<{ found: number; upserted: number } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  async function runImport() {
    setImportState('running')
    setImportError(null)
    setImportResult(null)
    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: importLimit }),
      })
      const data = await res.json()
      if (!res.ok) {
        setImportError(data.error ?? 'Import failed')
        setImportState('error')
      } else {
        setImportResult({ found: data.found, upserted: data.upserted })
        setImportState('done')
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Unknown error')
      setImportState('error')
    }
  }
  const [spots, setSpots] = useState(initialSpots)
  const [reviews, setReviews] = useState(initialReviews)
  const [scoutRuns] = useState<ScoutRunRow[]>(initialScoutRuns)
  const [spotFilter, setSpotFilter] = useState<SpotFilter>('pending')
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('pending')
  const [loading, setLoading] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [scoutPendingOnly, setScoutPendingOnly] = useState(false)

  // Rolling 24h cost from scout_runs, so the admin can sanity-check
  // we're nowhere near the $3 daily cap. Snapshot "now" once at mount
  // (React 19's purity rule disallows Date.now() during render); a
  // tab-load-time freshness is plenty for an admin dashboard.
  const [renderedAt] = useState(() => Date.now())
  const { scoutCost24h, scoutInserted24h } = useMemo(() => {
    const cutoff = renderedAt - 24 * 60 * 60 * 1000
    let cost = 0
    let inserted = 0
    for (const r of scoutRuns) {
      if (new Date(r.started_at).getTime() >= cutoff) {
        cost += Number(r.total_cost_usd ?? 0)
        inserted += r.candidates_inserted ?? 0
      }
    }
    return { scoutCost24h: cost, scoutInserted24h: inserted }
  }, [scoutRuns, renderedAt])

  function handleSpotEdited(updated: Spot) {
    setSpots((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
    setEditingId(null)
  }

  const pendingSpots = spots.filter((s) => s.status === 'pending').length
  const pendingReviews = reviews.filter((r) => r.status === 'pending').length
  const pendingFromScout = spots.filter((s) => s.status === 'pending' && s.submitted_by === 'scout-agent').length

  const filteredSpots = (spotFilter === 'all' ? spots : spots.filter((s) => s.status === spotFilter))
    .filter((s) => !scoutPendingOnly || (s.status === 'pending' && s.submitted_by === 'scout-agent'))
  const filteredReviews = reviewFilter === 'all' ? reviews : reviews.filter((r) => r.status === reviewFilter)

  async function handleSpotAction(id: string, status: 'approved' | 'rejected') {
    setLoading(id)
    await updateSpotStatus(id, status)
    setSpots((prev) => prev.map((s) => s.id === id ? { ...s, status } : s))
    setLoading(null)
  }

  async function handleReviewAction(id: string, status: 'approved' | 'rejected') {
    setLoading(id)
    await updateReviewStatus(id, status)
    setReviews((prev) => prev.map((r) => r.id === id ? { ...r, status } : r))
    setLoading(null)
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
            Admin Dashboard
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Moderate spots and reviews before they go live.
          </p>
        </div>
        <Link
          href="/roadmap"
          className="text-xs font-medium px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-80"
          style={{
            borderColor: 'var(--border)',
            color: 'var(--text-secondary)',
            backgroundColor: 'var(--surface-2)',
          }}
        >
          View roadmap →
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Spots', value: spots.length },
          { label: 'Pending Spots', value: pendingSpots, highlight: pendingSpots > 0 },
          { label: 'Total Reviews', value: reviews.length },
          { label: 'Pending Reviews', value: pendingReviews, highlight: pendingReviews > 0 },
        ].map(({ label, value, highlight }) => (
          <div
            key={label}
            className="p-4 rounded-xl border"
            style={{
              backgroundColor: highlight ? 'rgba(198,133,18,0.06)' : 'var(--surface)',
              borderColor: highlight ? 'rgba(198,133,18,0.2)' : 'var(--border-subtle)',
            }}
          >
            <p className="text-2xl font-bold" style={{ color: highlight ? 'var(--kinda)' : 'var(--text-primary)' }}>
              {value}
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        {(['spots', 'reviews', 'scout', 'import'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-2.5 text-sm font-medium capitalize relative transition-colors"
            style={{ color: tab === t ? 'var(--accent)' : 'var(--text-secondary)' }}
          >
            {t}
            {t === 'spots' && pendingSpots > 0 && (
              <span
                className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-bold"
                style={{ backgroundColor: 'rgba(198,133,18,0.15)', color: 'var(--kinda)' }}
              >
                {pendingSpots}
              </span>
            )}
            {t === 'reviews' && pendingReviews > 0 && (
              <span
                className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-bold"
                style={{ backgroundColor: 'rgba(198,133,18,0.15)', color: 'var(--kinda)' }}
              >
                {pendingReviews}
              </span>
            )}
            {t === 'scout' && scoutRuns.length > 0 && (
              <span
                className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-bold"
                style={{ backgroundColor: 'rgba(99,102,241,0.15)', color: '#6366f1' }}
              >
                {scoutRuns.length}
              </span>
            )}
            {tab === t && (
              <div
                className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t-full"
                style={{ backgroundColor: 'var(--accent)' }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Spots Tab */}
      {tab === 'spots' && (
        <div>
          {/* Filter */}
          <div className="flex gap-2 mb-4 flex-wrap">
            {(['all', 'pending', 'approved', 'rejected'] as SpotFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setSpotFilter(f)}
                className="px-3 py-1 rounded-full text-xs font-medium border transition-all capitalize"
                style={
                  spotFilter === f
                    ? { backgroundColor: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' }
                    : { backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }
                }
              >
                {f} {f !== 'all' && `(${spots.filter((s) => s.status === f).length})`}
              </button>
            ))}
            {pendingFromScout > 0 && (
              <button
                onClick={() => {
                  setScoutPendingOnly((v) => !v)
                  if (!scoutPendingOnly) setSpotFilter('pending')
                }}
                className="px-3 py-1 rounded-full text-xs font-medium border transition-all inline-flex items-center gap-1.5"
                style={
                  scoutPendingOnly
                    ? { backgroundColor: '#6366f1', color: 'white', borderColor: '#6366f1' }
                    : { backgroundColor: 'rgba(99,102,241,0.10)', color: '#6366f1', borderColor: 'rgba(99,102,241,0.3)' }
                }
                title="Show only pending spots discovered by the Scout agent"
              >
                <Telescope size={11} />
                from scout ({pendingFromScout})
              </button>
            )}
          </div>

          {/* Spots list */}
          <div className="space-y-2">
            {filteredSpots.length === 0 ? (
              <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                No spots in this category.
              </p>
            ) : (
              filteredSpots.map((spot) => (
                <div key={spot.id}>
                  <div
                    className="flex items-start gap-3 p-4 rounded-xl border"
                    style={{
                      backgroundColor: 'var(--surface)',
                      borderColor: editingId === spot.id ? 'var(--accent)' : 'var(--border-subtle)',
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                          {spot.name}
                        </span>
                        <StatusBadge status={spot.status} />
                        {spot.submitted_by === 'scout-agent' && (
                          <span
                            className="text-[10px] font-medium px-1.5 py-0.5 rounded-full inline-flex items-center gap-1"
                            style={{ backgroundColor: 'rgba(99,102,241,0.12)', color: '#6366f1' }}
                            title="Discovered by the Scout agent"
                          >
                            <Telescope size={9} />
                            scout
                          </span>
                        )}
                        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {typeLabel(spot.type)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs flex-wrap" style={{ color: 'var(--text-muted)' }}>
                        <span className="flex items-center gap-1">
                          <MapPin size={10} />
                          {spot.neighborhood ? `${spot.neighborhood}, ` : ''}{spot.city}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock size={10} />
                          {formatHoursDisplay(spot.hours)}
                        </span>
                        {spot.submitted_by && (
                          <span>by {spot.submitted_by}</span>
                        )}
                      </div>
                      {/* Live amenity chips so you can see what the import auto-tagged */}
                      <div className="flex items-center gap-1.5 mt-2 text-[10px] flex-wrap">
                        {[
                          { on: spot.has_wifi, label: 'wifi' },
                          { on: spot.has_outlets, label: 'outlets' },
                          { on: spot.laptop_friendly, label: 'laptop' },
                          { on: spot.has_food, label: 'food' },
                          { on: spot.has_drinks, label: 'drinks' },
                        ].map(({ on, label }) => (
                          <span
                            key={label}
                            className="px-1.5 py-0.5 rounded"
                            style={{
                              backgroundColor: on ? 'rgba(47,125,79,0.12)' : 'var(--surface-3)',
                              color: on ? 'var(--yes)' : 'var(--text-muted)',
                            }}
                          >
                            {on ? '✓' : '·'} {label}
                          </span>
                        ))}
                      </div>
                      {spot.notes && (
                        <p className="text-xs mt-1.5 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
                          {spot.notes}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => setEditingId(editingId === spot.id ? null : spot.id)}
                        className="p-2 rounded-lg border transition-colors"
                        style={
                          editingId === spot.id
                            ? {
                                borderColor: 'var(--accent)',
                                backgroundColor: 'var(--accent)',
                                color: 'white',
                              }
                            : {
                                borderColor: 'var(--border)',
                                color: 'var(--text-muted)',
                              }
                        }
                        title={editingId === spot.id ? 'Close editor' : 'Edit fields'}
                      >
                        <Pencil size={14} />
                      </button>
                      {spot.status === 'approved' && (
                        <Link
                          href={`/spot/${spot.slug}`}
                          target="_blank"
                          className="p-2 rounded-lg border transition-colors hover:text-white"
                          style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                          title="View"
                        >
                          <Eye size={14} />
                        </Link>
                      )}
                      {spot.status !== 'approved' && (
                        <button
                          onClick={() => handleSpotAction(spot.id, 'approved')}
                          disabled={loading === spot.id}
                          className="p-2 rounded-lg border transition-colors"
                          style={{
                            borderColor: 'rgba(47,125,79,0.3)',
                            backgroundColor: 'rgba(47,125,79,0.08)',
                            color: 'var(--yes)',
                          }}
                          title="Approve"
                        >
                          <Check size={14} />
                        </button>
                      )}
                      {spot.status !== 'rejected' && (
                        <button
                          onClick={() => handleSpotAction(spot.id, 'rejected')}
                          disabled={loading === spot.id}
                          className="p-2 rounded-lg border transition-colors"
                          style={{
                            borderColor: 'rgba(168,57,47,0.3)',
                            backgroundColor: 'rgba(168,57,47,0.08)',
                            color: 'var(--no)',
                          }}
                          title="Reject"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  {editingId === spot.id && (
                    <SpotEditPanel
                      spot={spot}
                      onSaved={handleSpotEdited}
                      onCancel={() => setEditingId(null)}
                    />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Reviews Tab */}
      {tab === 'reviews' && (
        <div>
          <div className="flex gap-2 mb-4">
            {(['all', 'pending', 'approved', 'rejected'] as ReviewFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setReviewFilter(f)}
                className="px-3 py-1 rounded-full text-xs font-medium border transition-all capitalize"
                style={
                  reviewFilter === f
                    ? { backgroundColor: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' }
                    : { backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }
                }
              >
                {f} {f !== 'all' && `(${reviews.filter((r) => r.status === f).length})`}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {filteredReviews.length === 0 ? (
              <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                No reviews in this category.
              </p>
            ) : (
              filteredReviews.map((review) => (
                <div
                  key={review.id}
                  className="flex items-start gap-3 p-4 rounded-xl border"
                  style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                        {review.author_name}
                      </span>
                      <StatusBadge status={review.status} />
                      {review.spot_name && (
                        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          on {review.spot_name}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-3 mt-1.5 text-xs flex-wrap" style={{ color: 'var(--text-muted)' }}>
                      {review.wifi_rating && <span>Wifi: {review.wifi_rating}/5</span>}
                      {review.outlet_rating && <span>Outlets: {review.outlet_rating}/5</span>}
                      {review.late_night_rating && <span>Night: {review.late_night_rating}/5</span>}
                      {review.seating_rating && <span>Seating: {review.seating_rating}/5</span>}
                    </div>
                    {review.comment && (
                      <p className="text-xs mt-1.5 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
                        &ldquo;{review.comment}&rdquo;
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {review.status !== 'approved' && (
                      <button
                        onClick={() => handleReviewAction(review.id, 'approved')}
                        disabled={loading === review.id}
                        className="p-2 rounded-lg border transition-colors"
                        style={{
                          borderColor: 'rgba(47,125,79,0.3)',
                          backgroundColor: 'rgba(47,125,79,0.08)',
                          color: 'var(--yes)',
                        }}
                        title="Approve"
                      >
                        <Check size={14} />
                      </button>
                    )}
                    {review.status !== 'rejected' && (
                      <button
                        onClick={() => handleReviewAction(review.id, 'rejected')}
                        disabled={loading === review.id}
                        className="p-2 rounded-lg border transition-colors"
                        style={{
                          borderColor: 'rgba(168,57,47,0.3)',
                          backgroundColor: 'rgba(168,57,47,0.08)',
                          color: 'var(--no)',
                        }}
                        title="Reject"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Scout Tab */}
      {tab === 'scout' && (
        <div className="max-w-3xl space-y-4">
          <div
            className="p-5 rounded-xl border"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
          >
            <div className="flex items-start gap-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                style={{ backgroundColor: 'rgba(99,102,241,0.15)' }}
              >
                <Telescope size={15} style={{ color: '#6366f1' }} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                  Scout Agent
                </h3>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  Every 4 hours, the Scout picks the highest-priority city that hasn&apos;t been
                  scouted in the last week and pulls up to {' '}
                  <span style={{ color: 'var(--text-primary)' }}>25 new candidates</span> from
                  Google Places. New rows land as <code className="text-[11px] px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--surface-3)' }}>pending</code>
                  {' '}with a <span style={{ color: '#6366f1' }}>scout</span> badge — Curator scores
                  them on the next daily pass, and you approve them from the Spots tab.
                </p>
              </div>
            </div>
          </div>

          {/* Rolling cost / cap summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Runs (last 50)', value: scoutRuns.length.toString() },
              { label: 'Inserted (24h)', value: scoutInserted24h.toString() },
              { label: 'Cost (24h)', value: `$${scoutCost24h.toFixed(4)}` },
              { label: 'Daily cap', value: '$3.00' },
            ].map((m) => (
              <div
                key={m.label}
                className="p-3 rounded-xl border"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
              >
                <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{m.value}</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{m.label}</p>
              </div>
            ))}
          </div>

          {/* Runs table */}
          <div
            className="rounded-xl border overflow-hidden"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
          >
            <div className="px-4 py-3 border-b text-xs font-semibold uppercase tracking-wide" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
              Recent runs
            </div>
            {scoutRuns.length === 0 ? (
              <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                No Scout runs yet. The scheduled task runs every 4 hours.
              </p>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                {scoutRuns.map((r) => {
                  const palette: Record<string, { bg: string; color: string }> = {
                    running:  { bg: 'rgba(99,102,241,0.10)', color: '#6366f1' },
                    success:  { bg: 'rgba(47,125,79,0.12)',  color: 'var(--yes)' },
                    partial:  { bg: 'rgba(198,133,18,0.12)', color: 'var(--kinda)' },
                    cap_hit:  { bg: 'rgba(198,133,18,0.12)', color: 'var(--kinda)' },
                    skipped:  { bg: 'rgba(120,120,120,0.10)', color: 'var(--text-muted)' },
                    error:    { bg: 'rgba(168,57,47,0.12)',  color: 'var(--no)' },
                  }
                  const p = palette[r.status] ?? palette.skipped
                  const started = new Date(r.started_at)
                  return (
                    <div key={r.run_id} className="px-4 py-3 flex flex-col gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: p.bg, color: p.color }}
                        >
                          {r.status}
                        </span>
                        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                          {r.city ?? '—'}
                          {r.neighborhood ? ` / ${r.neighborhood}` : ''}
                        </span>
                        <span style={{ color: 'var(--text-muted)' }}>
                          {started.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 flex-wrap" style={{ color: 'var(--text-muted)' }}>
                        <span>examined <strong style={{ color: 'var(--text-secondary)' }}>{r.candidates_examined}</strong></span>
                        <span>inserted <strong style={{ color: 'var(--text-secondary)' }}>{r.candidates_inserted}</strong></span>
                        <span>cost <strong style={{ color: 'var(--text-secondary)' }}>${Number(r.total_cost_usd).toFixed(4)}</strong></span>
                      </div>
                      {r.error_message && (
                        <p className="text-[11px] mt-1" style={{ color: 'var(--no)' }}>
                          {r.error_message}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Caps: $0.50/run, $3.00/24h. Cron secret stored in <code className="px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--surface-3)' }}>SCOUT_CRON_SECRET</code>.
            City queue and last-scouted timestamps live in <code className="px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--surface-3)' }}>scout_priority</code>.
          </p>
        </div>
      )}

      {/* Import Tab */}
      {tab === 'import' && (
        <div className="max-w-2xl space-y-6">
          {/* Intro */}
          <div
            className="p-5 rounded-xl border"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
          >
            <div className="flex items-start gap-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                style={{ backgroundColor: 'rgba(66,133,244,0.15)' }}
              >
                <Download size={15} style={{ color: '#4285F4' }} />
              </div>
              <div>
                <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                  Import from Google Places
                </h3>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  Searches Google Places for late-night work spots across NYC. Pulls real photos, hours,
                  and reviews — then scores each spot on wifi, outlets, noise, seating, and late-night
                  suitability automatically from review text analysis.
                </p>
              </div>
            </div>
          </div>

          {/* Requirements */}
          <div
            className="p-4 rounded-xl border"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
          >
            <h4 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>
              Requirements
            </h4>
            <div className="space-y-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <div className="flex items-start gap-2">
                <span className="mt-0.5">1.</span>
                <span>
                  Get a{' '}
                  <a
                    href="https://console.cloud.google.com/apis/library/places-backend.googleapis.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                    style={{ color: '#4285F4' }}
                  >
                    Google Places API key
                  </a>{' '}
                  and enable <strong>Places API (New)</strong>
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5">2.</span>
                <span>
                  Add it to your <code className="px-1 py-0.5 rounded text-[11px]" style={{ backgroundColor: 'var(--surface-3)' }}>.env.local</code>:
                </span>
              </div>
              <div
                className="ml-4 p-3 rounded-lg font-mono text-[11px] leading-relaxed"
                style={{ backgroundColor: 'var(--surface-3)', color: 'var(--yes)' }}
              >
                GOOGLE_PLACES_API_KEY=AIzaSy...
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5">3.</span>
                <span>Make sure your Supabase credentials are also set (for the import to write to DB).</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5">4.</span>
                <span>
                  Or run locally via CLI:{' '}
                  <code className="px-1 py-0.5 rounded text-[11px]" style={{ backgroundColor: 'var(--surface-3)' }}>
                    npm run import:nyc
                  </code>
                </span>
              </div>
            </div>
          </div>

          {/* Config */}
          <div
            className="p-4 rounded-xl border space-y-4"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
          >
            <h4 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              Import Settings
            </h4>
            <div>
              <label className="block text-xs mb-2 font-medium" style={{ color: 'var(--text-secondary)' }}>
                Max spots to import
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={10}
                  max={200}
                  step={10}
                  value={importLimit}
                  onChange={(e) => setImportLimit(Number(e.target.value))}
                  className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span
                  className="w-10 text-center text-sm font-bold shrink-0"
                  style={{ color: 'var(--accent)' }}
                >
                  {importLimit}
                </span>
              </div>
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                ~${(importLimit * 0.05).toFixed(2)} estimated API cost · 13 NYC search queries · {Math.ceil(importLimit / 20)} pages
              </p>
            </div>

            <div
              className="p-3 rounded-lg text-xs"
              style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }}
            >
              <strong style={{ color: 'var(--text-secondary)' }}>What gets scored automatically:</strong>
              <div className="mt-1.5 grid grid-cols-2 gap-1">
                {['Wi-Fi (review keywords)', 'Outlets (review keywords)', 'Noise level (review sentiment)', 'Seating comfort (price level + reviews)', 'Late-night score (hours + review text)', 'Work score (composite)'].map((item) => (
                  <div key={item} className="flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: 'var(--yes)' }} />
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Action */}
          <div className="space-y-3">
            <button
              onClick={runImport}
              disabled={importState === 'running'}
              className={cn(
                'w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-opacity',
                importState === 'running' ? 'opacity-60 cursor-not-allowed' : ''
              )}
              style={{ backgroundColor: '#4285F4', color: 'white' }}
            >
              {importState === 'running' ? (
                <>
                  <RefreshCw size={15} className="animate-spin" />
                  Importing… this takes 1–3 minutes
                </>
              ) : (
                <>
                  <Download size={15} />
                  Import NYC Spots from Google Places
                </>
              )}
            </button>

            {importState === 'running' && (
              <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
                Fetching places, pulling reviews, scoring spots… do not close this tab.
              </p>
            )}

            {importState === 'done' && importResult && (
              <div
                className="flex items-center gap-3 p-4 rounded-xl border"
                style={{ backgroundColor: 'rgba(47,125,79,0.08)', borderColor: 'rgba(47,125,79,0.2)' }}
              >
                <CheckCircle2 size={18} style={{ color: 'var(--yes)' }} />
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--yes)' }}>
                    Import complete
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                    Found {importResult.found} places · Upserted {importResult.upserted} spots to database
                  </p>
                </div>
              </div>
            )}

            {importState === 'error' && importError && (
              <div
                className="flex items-start gap-3 p-4 rounded-xl border"
                style={{ backgroundColor: 'rgba(168,57,47,0.08)', borderColor: 'rgba(168,57,47,0.2)' }}
              >
                <AlertCircle size={18} className="shrink-0 mt-0.5" style={{ color: 'var(--no)' }} />
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--no)' }}>Import failed</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{importError}</p>
                </div>
              </div>
            )}
          </div>

          {/* CLI alternative */}
          <div
            className="p-4 rounded-xl border"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
          >
            <h4 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>
              CLI Alternative (Recommended for Large Imports)
            </h4>
            <div className="space-y-2 text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
              <div
                className="p-2.5 rounded-lg"
                style={{ backgroundColor: 'var(--surface-2)' }}
              >
                <span style={{ color: 'var(--text-muted)' }}># Basic import (up to 200 spots)</span>
                <br />
                <span style={{ color: 'var(--yes)' }}>npm run import:nyc</span>
              </div>
              <div
                className="p-2.5 rounded-lg"
                style={{ backgroundColor: 'var(--surface-2)' }}
              >
                <span style={{ color: 'var(--text-muted)' }}># Dry run — see results without writing to DB</span>
                <br />
                <span style={{ color: 'var(--yes)' }}>npm run import:nyc -- --dry-run</span>
              </div>
              <div
                className="p-2.5 rounded-lg"
                style={{ backgroundColor: 'var(--surface-2)' }}
              >
                <span style={{ color: 'var(--text-muted)' }}># Write to JSON file instead</span>
                <br />
                <span style={{ color: 'var(--yes)' }}>npm run import:nyc -- --output=nyc-spots.json</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
