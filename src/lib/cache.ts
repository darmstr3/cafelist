import * as fs from 'fs'
import * as path from 'path'
import { CityCache } from '@/types/cafe'

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000  // 7 days

// In-memory fallback (works across requests in same serverless instance)
const memoryCache = new Map<string, CityCache>()

// ── File paths ────────────────────────────────────────────────

function getCacheDir(): string {
  // On Vercel: /tmp is the only writable dir
  // Locally: ./data/
  if (process.env.VERCEL) return '/tmp/groundwork-cache'
  return path.join(process.cwd(), 'data')
}

function getCacheFilePath(citySlug: string): string {
  return path.join(getCacheDir(), `${citySlug}.json`)
}

function ensureCacheDir() {
  const dir = getCacheDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

// ── Slug helper ───────────────────────────────────────────────

export function toCitySlug(city: string): string {
  return city
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
}

// ── Read ──────────────────────────────────────────────────────

/** Returns cache only if fresh (within TTL). */
export function readCache(citySlug: string): CityCache | null {
  const cache = readCacheAny(citySlug)
  if (!cache) return null
  if (!isFresh(cache)) {
    console.log(`[cache] ${citySlug} is stale — will re-scrape in background`)
    return null
  }
  return cache
}

/** Returns cache regardless of age — used for stale-while-revalidate. */
export function readCacheAny(citySlug: string): CityCache | null {
  // Check memory first
  const mem = memoryCache.get(citySlug)
  if (mem) return mem

  // Try file
  try {
    const filePath = getCacheFilePath(citySlug)
    if (!fs.existsSync(filePath)) return null

    const raw = fs.readFileSync(filePath, 'utf-8')
    const cache: CityCache = JSON.parse(raw)

    // Warm memory cache
    memoryCache.set(citySlug, cache)
    return cache
  } catch (err) {
    console.warn('[cache] Read error:', err)
    return null
  }
}

// ── Write ─────────────────────────────────────────────────────

export function writeCache(cache: CityCache): void {
  // Always write to memory
  memoryCache.set(cache.citySlug, cache)

  // Try file
  try {
    ensureCacheDir()
    const filePath = getCacheFilePath(cache.citySlug)
    fs.writeFileSync(filePath, JSON.stringify(cache, null, 2), 'utf-8')
    console.log(`[cache] Written to ${filePath} (${cache.cafes.length} cafes)`)
  } catch (err) {
    console.warn('[cache] File write failed (using memory only):', err)
  }
}

// ── Freshness ─────────────────────────────────────────────────

export function isFresh(cache: CityCache): boolean {
  const age = Date.now() - new Date(cache.cachedAt).getTime()
  return age < CACHE_TTL_MS
}

export function cacheAge(cache: CityCache): string {
  const ageMs = Date.now() - new Date(cache.cachedAt).getTime()
  const hours = Math.floor(ageMs / (1000 * 60 * 60))
  const minutes = Math.floor((ageMs % (1000 * 60 * 60)) / (1000 * 60))
  if (hours === 0) return `${minutes}m ago`
  return `${hours}h ${minutes}m ago`
}

// ── List cached cities ────────────────────────────────────────

export function listCachedCities(): Array<{ slug: string; city: string; count: number; age: string }> {
  const results = []

  // Memory
  for (const [slug, cache] of memoryCache.entries()) {
    if (isFresh(cache)) {
      results.push({ slug, city: cache.city, count: cache.cafes.length, age: cacheAge(cache) })
    }
  }

  // File (de-dup with memory)
  try {
    const dir = getCacheDir()
    if (!fs.existsSync(dir)) return results

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
    for (const file of files) {
      const slug = file.replace('.json', '')
      if (results.some((r) => r.slug === slug)) continue
      try {
        const raw = fs.readFileSync(path.join(dir, file), 'utf-8')
        const cache: CityCache = JSON.parse(raw)
        if (isFresh(cache)) {
          results.push({ slug, city: cache.city, count: cache.cafes.length, age: cacheAge(cache) })
        }
      } catch {}
    }
  } catch {}

  return results
}
