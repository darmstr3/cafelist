'use client'

import { useState, FormEvent, useEffect, useRef } from 'react'
import { Search, Loader2 } from 'lucide-react'

const POPULAR_CITIES = [
  'New York City', 'Los Angeles', 'Chicago', 'Austin',
  'San Francisco', 'Seattle', 'Miami', 'Boston',
  'Denver', 'Portland', 'Nashville', 'Washington DC',
  'London', 'Berlin', 'Lisbon', 'Amsterdam',
]

const POLL_INTERVAL_MS = 8_000

interface Props {
  onResults: (data: {
    cafes: import('@/types/cafe').CafeRecord[]
    city: string
    fromCache: boolean
    cachedAt: string | null
  }) => void
  onError: (msg: string) => void
  onLoading: (loading: boolean, city?: string) => void
  initialCity?: string
}

export function CitySearch({ onResults, onError, onLoading, initialCity }: Props) {
  const [city, setCity] = useState(initialCity ?? '')
  const [loading, setLoading] = useState(false)
  const didAutoSearch = useRef(false)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeCity = useRef('')

  function clearPoll() {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current)
      pollTimer.current = null
    }
  }

  async function fetchCity(searchCity: string): Promise<boolean> {
    // Returns true when done (results or error), false when still running
    try {
      const res = await fetch(`/api/search?city=${encodeURIComponent(searchCity)}`)
      const data = await res.json()

      // Bail if user started a different search while this was in flight
      if (activeCity.current !== searchCity) return true

      if (!res.ok || data.error) {
        onError(data.error ?? 'Search failed. Please try again.')
        return true
      }

      if (data.status === 'running') {
        return false // keep polling
      }

      onResults({
        cafes: data.cafes,
        city: data.city,
        fromCache: data.fromCache,
        cachedAt: data.cachedAt,
      })
      return true
    } catch {
      if (activeCity.current === searchCity) {
        onError('Network error. Please check your connection and try again.')
      }
      return true
    }
  }

  async function handleSearch(searchCity: string) {
    const trimmed = searchCity.trim()
    if (!trimmed) return

    clearPoll()
    activeCity.current = trimmed

    setLoading(true)
    setCity(trimmed)
    onLoading(true, trimmed)
    onError('')

    const done = await fetchCity(trimmed)

    if (done) {
      setLoading(false)
      onLoading(false)
      return
    }

    // Still scraping — start polling loop
    function scheduleNextPoll() {
      pollTimer.current = setTimeout(async () => {
        if (activeCity.current !== trimmed) return
        const isDone = await fetchCity(trimmed)
        if (!isDone) {
          scheduleNextPoll()
        } else {
          setLoading(false)
          onLoading(false)
        }
      }, POLL_INTERVAL_MS)
    }
    scheduleNextPoll()
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => clearPoll()
  }, [])

  // Auto-search on first mount
  useEffect(() => {
    if (initialCity && !didAutoSearch.current) {
      didAutoSearch.current = true
      handleSearch(initialCity)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    handleSearch(city)
  }

  return (
    <div className="w-full max-w-2xl">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none z-10"
            style={{ color: 'var(--text-muted)' }}
          />
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Search any city…"
            className="w-full pl-9 pr-4 py-3 rounded-xl text-sm border"
            style={{
              height: '48px',
              backgroundColor: 'var(--surface-2)',
              borderColor: 'var(--border)',
              color: 'var(--text-primary)',
            }}
            disabled={loading}
            autoComplete="off"
          />
        </div>

        <button
          type="submit"
          disabled={loading || !city.trim()}
          className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-50 shrink-0"
          style={{ backgroundColor: 'var(--accent)', color: 'white', height: '48px' }}
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
          {loading ? 'Scraping…' : 'Search'}
        </button>
      </form>

      {/* Popular cities */}
      <div className="flex flex-wrap gap-1.5 mt-3">
        {POPULAR_CITIES.map((c) => (
          <button
            key={c}
            onClick={() => handleSearch(c)}
            disabled={loading}
            className="px-2.5 py-1 rounded-full text-xs border transition-all hover:border-opacity-80 disabled:opacity-40"
            style={{
              backgroundColor: 'var(--surface-2)',
              borderColor: 'var(--border)',
              color: 'var(--text-secondary)',
            }}
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  )
}
