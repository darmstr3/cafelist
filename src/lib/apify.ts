// ─────────────────────────────────────────────────────────────
// DEPRECATED — Apify integration was removed in Phase 1.
// All scraping is now done via Google Places API (src/lib/google-places.ts).
// This file is a stub to keep dead imports from breaking the build.
// Safe to delete this file and src/lib/actors/ via Finder.
// ─────────────────────────────────────────────────────────────

export interface RunActorOptions {
  actorId: string
  input: Record<string, unknown>
  timeoutSecs?: number
  memoryMbytes?: number
  maxItems?: number
}

export async function runActor<T = Record<string, unknown>>(
  _options: RunActorOptions
): Promise<T[]> {
  throw new Error(
    '[apify] runActor is deprecated. Use src/lib/google-places.ts instead. ' +
    'This stub exists only so the build passes while orphan files are cleaned up.'
  )
}
