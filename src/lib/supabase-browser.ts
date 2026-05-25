/**
 * Browser-side Supabase client with cookie-based session storage.
 * Use this in client components ('use client') for anything that needs
 * the current user's session (auth state, RLS-aware reads, etc.)
 *
 * For server components / route handlers, use ./supabase-server.ts.
 * For ambient anonymous reads (no auth context), the older ./supabase.ts
 * still works.
 */

import { createBrowserClient } from '@supabase/ssr'

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
