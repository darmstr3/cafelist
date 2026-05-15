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
