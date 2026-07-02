// ─────────────────────────────────────────────────────────────
// Algolia search client (browser-side).
//
// SECURITY: this file only ever touches the *Search-Only* key. The Admin
// key lives server-side (Supabase secret) and never ships to the browser.
// A search-only key can query but cannot write/delete — so exposing it in
// client JS is expected and safe.
//
// The whole surface is gated behind NEXT_PUBLIC_ALGOLIA_ENABLED so it can
// ship to main dark and be flipped on per-environment (preview first).
// ─────────────────────────────────────────────────────────────
import { liteClient } from 'algoliasearch/lite'

export const ALGOLIA_INDEX = 'cafelist_spots'

const appId = process.env.NEXT_PUBLIC_ALGOLIA_APP_ID
const searchKey = process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_KEY

/** True only when the flag is on AND both public keys are present. */
export const algoliaEnabled =
  process.env.NEXT_PUBLIC_ALGOLIA_ENABLED === 'true' && !!appId && !!searchKey

// `liteClient` is the search-only build of the JS client — smaller bundle,
// no write methods. Null when disabled so callers must handle the off state.
export const searchClient = algoliaEnabled ? liteClient(appId!, searchKey!) : null

/** Shape of a record in the cafelist_spots index (mirrors the indexer). */
export interface SpotRecord {
  objectID: string
  name: string
  slug: string
  neighborhood: string | null
  city: string
  type: string
  workability_score: number | null
  workability_band: string
  cover_photo: string | null
  has_wifi?: boolean
  has_outlets?: boolean
  laptop_friendly?: boolean
}
