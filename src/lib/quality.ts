// ─────────────────────────────────────────────────────────────
// Catalog quality thresholds — single source of truth.
//
// These numbers gate what the public surfaces are allowed to show.
// Previously the workability bar lived in three places that could
// drift (the /find retriever, the quality-gate script, and an
// implicit assumption on the homepage that turned out to be *no*
// gate at all). Import from here so they can never disagree again.
// ─────────────────────────────────────────────────────────────

/**
 * Minimum workability_score for a spot to appear on public surfaces
 * (homepage grid, default getSpots()). Mirrors the retriever's strict
 * pass. A spot below this — or with a NULL (unscored) workability_score —
 * is not "worth your time" yet and must not be published.
 */
export const PUBLIC_WORKABILITY_FLOOR = 6

/**
 * At or below this a spot is considered editorially *unfit* — the
 * demotion script (scripts/demote-unfit.ts) pulls approved rows under
 * this bar out of public visibility. Kept strictly below the public
 * floor so the 4–6 "friction" band can be triaged separately rather
 * than auto-removed.
 */
export const UNFIT_WORKABILITY_MAX = 4
