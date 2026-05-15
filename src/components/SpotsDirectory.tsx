'use client'

import { useState, useMemo } from 'react'
import { Spot, SpotFilters } from '@/types'
import { SpotCard } from './SpotCard'
import { FilterBar } from './FilterBar'
import { SearchBar } from './SearchBar'
import { isOpenNow, isOpenLate, isOpenAfterMidnight } from '@/lib/utils'
import { SlidersHorizontal } from 'lucide-react'

const DEFAULT_FILTERS: SpotFilters = {
  search: '',
  city: '',
  neighborhood: '',
  openNow: true,    // brief §3: pre-applied so the user sees what's open right now
  openLate: false,
  openAfter9pm: false,
  openAfterMidnight: false,
  hasWifi: false,
  hasOutlets: false,
  laptopFriendly: false,
  hasBathroom: false,
  hasFood: false,
  hasDrinks: false,
  noiseLevel: '',
  minWorkScore: 0,
  minLateNightScore: 0,
  type: '',
}

// Quick-filter pill bar — five most common toggles, surfaced above the
// directory so users don't have to open the full filter panel.
const QUICK_FILTERS: Array<{ key: keyof SpotFilters; label: string }> = [
  { key: 'openNow', label: 'Open now' },
  { key: 'hasWifi', label: 'Wi-Fi' },
  { key: 'hasOutlets', label: 'Outlets' },
  { key: 'openAfter9pm', label: 'Open late' },
  { key: 'openAfterMidnight', label: '24hr / past midnight' },
]

interface SpotsDirectoryProps {
  initialSpots: Spot[]
  cities: string[]
}

export function SpotsDirectory({ initialSpots, cities }: SpotsDirectoryProps) {
  const [filters, setFilters] = useState<SpotFilters>(DEFAULT_FILTERS)
  const [showFilters, setShowFilters] = useState(false)

  const filtered = useMemo(() => {
    return initialSpots.filter((spot) => {
      const q = filters.search.toLowerCase()
      if (q) {
        const haystack = `${spot.name} ${spot.city} ${spot.neighborhood ?? ''} ${spot.type}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }

      if (filters.city && !spot.city.toLowerCase().includes(filters.city.toLowerCase())) return false
      if (filters.neighborhood && spot.neighborhood !== filters.neighborhood) return false
      if (filters.type && spot.type !== filters.type) return false
      if (filters.hasWifi && !spot.has_wifi) return false
      if (filters.hasOutlets && !spot.has_outlets) return false
      if (filters.laptopFriendly && !spot.laptop_friendly) return false
      if (filters.hasBathroom && !spot.has_bathroom) return false
      if (filters.hasFood && !spot.has_food) return false
      if (filters.hasDrinks && !spot.has_drinks) return false
      if (filters.noiseLevel && spot.noise_level !== filters.noiseLevel) return false
      if (filters.minWorkScore > 0 && spot.work_score < filters.minWorkScore) return false
      if (filters.minLateNightScore > 0 && spot.late_night_score < filters.minLateNightScore) return false
      if (filters.openNow && !isOpenNow(spot.hours)) return false
      if (filters.openLate && !isOpenLate(spot.hours)) return false
      if (filters.openAfter9pm && !isOpenLate(spot.hours)) return false
      if (filters.openAfterMidnight && !isOpenAfterMidnight(spot.hours)) return false

      return true
    })
  }, [initialSpots, filters])

  const activeFilterCount = Object.entries(filters).filter(([k, v]) => {
    if (k === 'search' || k === 'city') return v !== ''
    if (typeof v === 'boolean') return v
    if (typeof v === 'number') return v > 0
    return v !== ''
  }).length

  const openNowCount = useMemo(
    () => initialSpots.filter((s) => isOpenNow(s.hours)).length,
    [initialSpots]
  )

  // Neighborhoods present in the data, sorted by count desc.
  // Powers the horizontal-scroll neighborhood pills below the quick filters.
  const neighborhoods = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of initialSpots) {
      if (!s.neighborhood) continue
      counts.set(s.neighborhood, (counts.get(s.neighborhood) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }))
  }, [initialSpots])

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* City header — anchors the user, signals breadth */}
      <div className="mb-4 flex items-baseline gap-2 flex-wrap">
        <h1 className="text-[20px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          New York
        </h1>
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {initialSpots.length} cafés · {openNowCount} open now
        </span>
      </div>

      {/* Quick filter pills — single-row, scroll on mobile */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-3 scrollbar-none">
        {QUICK_FILTERS.map(({ key, label }) => {
          const active = !!filters[key as keyof SpotFilters]
          return (
            <button
              key={key}
              onClick={() => setFilters((f) => ({ ...f, [key]: !active }))}
              className="px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap transition-all shrink-0"
              style={
                active
                  ? {
                      backgroundColor: 'var(--accent)',
                      color: 'white',
                      borderColor: 'var(--accent)',
                    }
                  : {
                      backgroundColor: 'var(--surface)',
                      color: 'var(--text-secondary)',
                      borderColor: 'var(--border)',
                    }
              }
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* Neighborhood pills — horizontal scroll, sorted by count desc.
          Tapping one filters; tapping again clears. */}
      {neighborhoods.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-2 mb-4 scrollbar-none">
          <button
            onClick={() => setFilters((f) => ({ ...f, neighborhood: '' }))}
            className="px-2.5 py-1 rounded-full text-[11px] font-medium border whitespace-nowrap transition-all shrink-0"
            style={
              filters.neighborhood === ''
                ? {
                    backgroundColor: 'var(--text-primary)',
                    color: 'var(--background)',
                    borderColor: 'var(--text-primary)',
                  }
                : {
                    backgroundColor: 'var(--surface-2)',
                    color: 'var(--text-secondary)',
                    borderColor: 'var(--border-subtle)',
                  }
            }
          >
            All
          </button>
          {neighborhoods.map(({ name, count }) => {
            const active = filters.neighborhood === name
            return (
              <button
                key={name}
                onClick={() =>
                  setFilters((f) => ({ ...f, neighborhood: active ? '' : name }))
                }
                className="px-2.5 py-1 rounded-full text-[11px] font-medium border whitespace-nowrap transition-all shrink-0 flex items-center gap-1"
                style={
                  active
                    ? {
                        backgroundColor: 'var(--text-primary)',
                        color: 'var(--background)',
                        borderColor: 'var(--text-primary)',
                      }
                    : {
                        backgroundColor: 'var(--surface-2)',
                        color: 'var(--text-secondary)',
                        borderColor: 'var(--border-subtle)',
                      }
                }
              >
                {name}
                <span
                  className="text-[10px] opacity-60"
                  style={{ color: active ? 'var(--background)' : 'var(--text-muted)' }}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Search + filter toggle */}
      <div className="flex items-center gap-3 mb-4">
        <SearchBar
          value={filters.search}
          onChange={(search) => setFilters((f) => ({ ...f, search }))}
        />
        <button
          onClick={() => setShowFilters((v) => !v)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all shrink-0"
          style={{
            backgroundColor: showFilters || activeFilterCount > 0 ? 'var(--accent)' : 'var(--surface-2)',
            color: showFilters || activeFilterCount > 0 ? 'white' : 'var(--text-secondary)',
            borderColor: showFilters || activeFilterCount > 0 ? 'var(--accent)' : 'var(--border)',
            height: '48px',
          }}
        >
          <SlidersHorizontal size={15} />
          <span className="hidden sm:inline">Filters</span>
          {activeFilterCount > 0 && (
            <span
              className="w-5 h-5 rounded-full text-xs flex items-center justify-center font-bold"
              style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
            >
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div
          className="p-4 rounded-xl border mb-5 fade-in"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          <FilterBar filters={filters} onChange={setFilters} cities={cities} />
        </div>
      )}

      {/* Filtered results count — only when filters narrow the list */}
      {filtered.length !== initialSpots.length && (
        <div className="mb-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          {filtered.length === 0
            ? 'No spots match these filters'
            : `${filtered.length} of ${initialSpots.length} cafés match`}
        </div>
      )}

      {/* Grid */}
      {filtered.length === 0 ? (
        <div
          className="rounded-xl border p-12 text-center"
          style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface)' }}
        >
          <div className="text-3xl mb-3">☕</div>
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
            No spots found
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Try adjusting your filters or{' '}
            <a href="/submit" className="underline" style={{ color: 'var(--accent)' }}>
              submit a new spot
            </a>
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3">
          {filtered.map((spot) => (
            <SpotCard key={spot.id} spot={spot} />
          ))}
        </div>
      )}
    </div>
  )
}
