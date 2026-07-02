// ─────────────────────────────────────────────────────────────
// scripts/algolia-index.ts
//
// Version-controlled Supabase → Algolia indexer (the artifact a customer
// owns and reviews). Mirrors the bootstrap Edge Function, using the
// algoliasearch v5 client.
//
// - replaceAllObjects: atomic, zero-downtime reindex that also removes
//   spots no longer 'approved' (saveObjects would leave them stale).
// - Settings + synonyms are set on the primary index; replaceAllObjects
//   copies them to the temp index before the atomic move.
//
// Run locally (Admin key required — server-side only, never in the app):
//   npx tsx scripts/algolia-index.ts
// ─────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { algoliasearch } from 'algoliasearch'
import * as fs from 'fs'
import * as path from 'path'

function loadEnv() {
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8')
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq === -1) continue
      const k = t.slice(0, eq).trim()
      if (!(k in process.env)) process.env[k] = t.slice(eq + 1).trim()
    }
  } catch { /* rely on ambient env */ }
}

const INDEX = 'cafelist_spots'

function band(s: number | null): string {
  if (s == null) return 'unrated'
  if (s >= 8) return 'great'
  if (s >= 6) return 'good'
  if (s >= 4) return 'ok'
  return 'low'
}

async function main() {
  loadEnv()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const appId = process.env.ALGOLIA_APP_ID ?? process.env.NEXT_PUBLIC_ALGOLIA_APP_ID
  const adminKey = process.env.ALGOLIA_ADMIN_KEY
  if (!url || !serviceKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  if (!appId || !adminKey) throw new Error('Missing ALGOLIA_APP_ID / ALGOLIA_ADMIN_KEY')

  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: spots, error } = await sb.from('spots').select('*').eq('status', 'approved')
  if (error) throw new Error(`Supabase read failed: ${error.message}`)

  const objects = (spots ?? []).map((s: Record<string, unknown>) => {
    const photos = s.photos as Array<{ url?: string }> | null
    return {
      objectID: s.id as string,
      name: s.name, slug: s.slug, city: s.city, neighborhood: s.neighborhood, type: s.type, address: s.address,
      vibe_tags: (s.vibe_tags as string[]) ?? [], notes: (s.notes as string) ?? '',
      has_wifi: !!s.has_wifi, has_outlets: !!s.has_outlets, laptop_friendly: !!s.laptop_friendly,
      has_bathroom: !!s.has_bathroom, has_food: !!s.has_food, has_drinks: !!s.has_drinks,
      noise_level: s.noise_level, work_score: s.work_score, workability_score: s.workability_score,
      workability_band: band(s.workability_score as number | null),
      cover_photo: Array.isArray(photos) && photos[0]?.url ? photos[0].url : null,
      ...(s.lat != null && s.lng != null ? { _geoloc: { lat: s.lat, lng: s.lng } } : {}),
    }
  })

  const client = algoliasearch(appId, adminKey)
  await client.setSettings({
    indexName: INDEX,
    indexSettings: {
      searchableAttributes: ['name', 'neighborhood', 'city', 'unordered(vibe_tags)', 'unordered(notes)', 'address'],
      attributesForFaceting: ['searchable(neighborhood)', 'city', 'type', 'has_wifi', 'has_outlets', 'laptop_friendly', 'has_bathroom', 'noise_level', 'workability_band'],
      customRanking: ['desc(workability_score)', 'desc(work_score)'],
      attributesToSnippet: ['notes:20'],
      typoTolerance: true,
      removeWordsIfNoResults: 'lastWords',
    },
  })
  await client.saveSynonyms({
    indexName: INDEX,
    synonymHit: [
      { objectID: 'wifi', type: 'synonym', synonyms: ['wifi', 'wi-fi', 'wireless'] },
      { objectID: 'outlets', type: 'synonym', synonyms: ['outlets', 'plugs', 'charging', 'power'] },
      { objectID: 'laptop', type: 'synonym', synonyms: ['laptop', 'work', 'working', 'remote work'] },
    ],
    replaceExistingSynonyms: true,
  })
  await client.replaceAllObjects({ indexName: INDEX, objects, batchSize: 1000 })
  console.log(`[algolia] reindexed ${objects.length} spots into ${INDEX} (atomic replaceAllObjects)`)
}

main().catch((e) => { console.error('[algolia] FATAL:', e); process.exit(1) })
