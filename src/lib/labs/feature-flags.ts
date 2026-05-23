// ─────────────────────────────────────────────────────────────
// Labs V2 feature flag
//
// Single source of truth for whether the V2 mode picker UI and
// the V2 payload shape are enabled.
//
// - Server (API routes, server components): reads LABS_V2_ENABLED.
// - Client (browser bundles): reads NEXT_PUBLIC_LABS_V2.
//
// Set both to "on" in Vercel preview env vars. Leave both unset
// (or "off") in production until V2 is end-to-end ready. The
// flip from V2-off to V2-on in prod is a Vercel env-var change,
// not a code change.
//
// See LABS_V2_PLAN.md §16 and DECISION_LOG ADR-0004.
// ─────────────────────────────────────────────────────────────

const TRUTHY = new Set(['on', '1', 'true', 'yes'])

/**
 * Returns true when the Labs V2 surface should render / accept
 * the new payload shape. Safe to call from both client and server.
 */
export function isLabsV2Enabled(): boolean {
  // Server-side: prefer the server-only env so a leaked client
  // bundle can't accidentally enable V2 in production.
  if (typeof window === 'undefined') {
    const serverFlag = process.env.LABS_V2_ENABLED ?? ''
    return TRUTHY.has(serverFlag.toLowerCase())
  }
  // Client-side: only NEXT_PUBLIC_ vars are inlined into the bundle.
  const clientFlag = process.env.NEXT_PUBLIC_LABS_V2 ?? ''
  return TRUTHY.has(clientFlag.toLowerCase())
}
