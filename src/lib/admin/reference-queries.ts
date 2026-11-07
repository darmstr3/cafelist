// ─────────────────────────────────────────────────────────────
// src/lib/admin/reference-queries.ts
//
// CRUD for design_references — the growing library of outside
// sites used as design benchmarks (see supabase/migrations/
// 20261107_design_references.sql). Service-role only, same
// posture as design_feedback / scout_runs.
// ─────────────────────────────────────────────────────────────

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase'

export interface ReferenceRow {
  id: string
  name: string
  url: string
  image_path: string | null
  note: string
  added_by: string
  created_at: string
}

export async function listReferences(): Promise<ReferenceRow[]> {
  if (!isSupabaseConfigured()) return []
  const { data, error } = await supabaseAdmin
    .from('design_references')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) {
    console.error('listReferences failed', error)
    return []
  }
  return data as ReferenceRow[]
}

export async function addReference(input: {
  name: string
  url: string
  note: string
  imagePath?: string
}): Promise<{ ok: boolean; error?: string }> {
  if (!input.name.trim() || !input.url.trim() || !input.note.trim()) {
    return { ok: false, error: 'name, url, and note are all required' }
  }
  const { error } = await supabaseAdmin.from('design_references').insert({
    name: input.name.trim(),
    url: input.url.trim(),
    note: input.note.trim(),
    image_path: input.imagePath ?? null,
  })
  if (error) {
    console.error('addReference failed', error)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}
