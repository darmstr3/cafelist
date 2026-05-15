'use client'

import { useState, useMemo } from 'react'
import { CafeRecord, CafeFilters } from '@/types/cafe'
import { CafeCard } from './CafeCard'
import { SlidersHorizontal, Clock, Star, Trophy } from 'lucide-react'

interface Props {
  cafes: CafeRecord[]
  city: string
  fromCache: boolean
  cachedAt: string | null
}

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'] as const

function isOpenNow(cafe: CafeRecord): boolean {
  const today = DAY_NAMES[new Date().getDay()]
  const hoursStr = cafe.hours[today]
  if (!hoursStr) return false
  const lower = hoursStr.toLowerCase()
  if (lower.includes('24 hour') || lower.includes('open 24')) return true
  const match = hoursStr.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*[–\-]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i)
  if (!match) return true
  let openH = parseInt(match[1])
  if (match[3].toUpperCase() === 'PM' && openH !== 12) openH += 12
  if (match[3].toUpperCase() === 'AM' && openH === 12) openH = 0
  let closeH = parseInt(match[4])
  if (match[6].toUpperCase() === 'PM' && closeH !== 12) closeH += 12
  if (match[6].toUpperCase() === 'AM' && closeH === 12) closeH = 0
  const now = new Date()
  const currentH = now.getHours() + now.getMinutes() / 60
  return currentH >= openH && currentH < closeH
}

const DEFAULT_FILTERS: CafeFilters = { minScore: 0, openNow: false, neighborhood: '', sortBy: 'score' }

type SortOption = 'score' | 'rating' | 'name'

export function CafeGrid({ cafes, city, fromCache, cachedAt }: Props) {
  const [filters, setFilters] = useState<CafeFilters>(DEFAULT_FILTERS)
  const [showFilters, setShowFilters] = useState(false)

  const neighborhoods = useMemo(() => {
    const set = new Set(cafes.map((c) => c.neighborhood).filter(Boolean) as string[])
    return [...set].sort()
  }, [cafes])

  const filtered = useMemo(() => {
    let result = [...cafes]
    if (filters.minScore > 0) result = result.filter((c) => c.score.total >= filters.minScore)
    if (filters.openNow) result = result.filter(isOpenNow)
    if (filters.neighborhood) result = result.filter((c) => c.neighborhood === filters.neighborhood)
    if (filters.sortBy === 'rating') result.sort((a, b) => b.rating - a.rating)
    else if (filters.sortBy === 'name') result.sort((a, b) => a.name.localeCompare(b.name))
    return result
  }, [cafes, filters])

  const set = (patch: Partial<CafeFilters>) => setFilters((f) => ({ ...f, ...patch }))
  const hasActiveFilters = filters.minScore > 0 || filters.openNow || !!filters.neighborhood || filters.sortBy !== 'score'
  const activeCount = [filters.minScore > 0, filters.openNow, !!filters.neighborhood, filters.sortBy !== 'score'].filter(Boolean).length

  return (
    <div>
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        {/* City + count */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="font-bold text-base truncate" style={{ color: 'var(--text-primary)' }}>
            {city}
          </span>
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
            — {filtered.length} cafes
          </span>
          {fromCache && cachedAt && (
            <span className="text-[10px] px-2 py-0.5 rounded-full hidden sm:inline-flex"
              style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
              cached
            </span>
          )}
        </div>

        {/* Sort pills */}
        <div className="flex items-center gap-1">
          {([
            { key: 'score', icon: <Trophy size={11} />, label: 'Score' },
            { key: 'rating', icon: <Star size={11} />, label: 'Rating' },
            { key: 'name', icon: null, label: 'A–Z' },
          ] as { key: SortOption; icon: React.ReactNode; label: string }[]).map(({ key, icon, label }) => (
            <button key={key} onClick={() => set({ sortBy: key })}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all"
              style={filters.sortBy === key
                ? { backgroundColor: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' }
                : { backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }}>
              {icon}{label}
            </button>
          ))}
        </div>

        {/* Filters toggle */}
        <button onClick={() => setShowFilters((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
          style={showFilters || hasActiveFilters
            ? { backgroundColor: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' }
            : { backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }}>
          <SlidersHorizontal size={12} />
          Filters
          {activeCount > 0 && (
            <span className="w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-bold"
              style={{ backgroundColor: 'rgba(255,255,255,0.25)' }}>{activeCount}</span>
          )}
        </button>
      </div>

      {/* ── Filter panel ── */}
      {showFilters && (
        <div className="p-4 rounded-xl border mb-5 fade-in flex flex-wrap gap-4"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}>

          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
              Min work score: <strong style={{ color: 'var(--accent)' }}>{filters.minScore || 'Any'}</strong>
            </label>
            <input type="range" min={0} max={90} step={5} value={filters.minScore}
              onChange={(e) => set({ minScore: Number(e.target.value) })}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{ accentColor: 'var(--accent)' }} />
            <div className="flex justify-between text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
              <span>0</span><span>45</span><span>90</span>
            </div>
          </div>

          <div className="flex items-center gap-2 self-center">
            <button onClick={() => set({ openNow: !filters.openNow })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all"
              style={filters.openNow
                ? { backgroundColor: 'var(--yes)', color: 'white', borderColor: 'var(--yes)' }
                : { backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }}>
              <Clock size={11} />
              Open Now
            </button>
          </div>

          {neighborhoods.length > 0 && (
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Neighborhood</label>
              <select value={filters.neighborhood} onChange={(e) => set({ neighborhood: e.target.value })}
                className="text-xs rounded-lg px-2 py-1.5 border"
                style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                <option value="">All</option>
                {neighborhoods.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          )}

          {hasActiveFilters && (
            <button onClick={() => setFilters(DEFAULT_FILTERS)}
              className="self-end text-xs underline underline-offset-2"
              style={{ color: 'var(--text-muted)' }}>
              Clear all
            </button>
          )}
        </div>
      )}

      {/* ── Grid ── */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center" style={{ color: 'var(--text-muted)' }}>
          <p className="text-4xl mb-3">☕</p>
          <p className="text-sm">No cafes match these filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((cafe, i) => (
            <CafeCard key={cafe.id} cafe={cafe} rank={i + 1} />
          ))}
        </div>
      )}
    </div>
  )
}
