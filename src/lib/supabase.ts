import { createClient, SupabaseClient } from '@supabase/supabase-js'

// These are safe to call at module evaluation time because env vars are
// always present (either real values or the placeholder in .env.local).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'placeholder'

// Client-side Supabase client (uses anon key, respects RLS)
export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey)

// Server-side admin client (bypasses RLS — server only)
export const supabaseAdmin: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey)

// Returns true when real Supabase credentials are configured.
// Modules that fall back to demo data when the DB is unreachable
// (e.g. `getSpots` in `./spots.ts` and the /admin/ops queries)
// use this to decide whether to make a real network call.
export function isSupabaseConfigured(): boolean {
  return supabaseUrl.length > 0 && !supabaseUrl.includes('placeholder')
}
