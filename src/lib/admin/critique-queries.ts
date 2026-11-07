// ─────────────────────────────────────────────────────────────
// src/lib/admin/critique-queries.ts
//
// CRUD for design_feedback (see supabase/migrations/20261107_design_feedback.sql).
// Service-role only — this table has no RLS policies, same posture
// as scout_runs. Never import this from client code.
// ─────────────────────────────────────────────────────────────

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase'
import { getFrame } from '@/lib/admin/critique-data'

export interface FeedbackRow {
  id: string
  project: string
  iteration_label: string
  frame_label: string
  image_path: string
  bbox: { x: number; y: number; w: number; h: number }
  note: string
  author: string
  status: 'pending' | 'queued' | 'resolved' | 'needs_review'
  group_label: string | null
  resolution: string | null
  created_at: string
  resolved_at: string | null
}

export async function listFeedback(frameImagePath?: string): Promise<FeedbackRow[]> {
  if (!isSupabaseConfigured()) return []
  let query = supabaseAdmin
    .from('design_feedback')
    .select('*')
    .order('created_at', { ascending: true })
  if (frameImagePath) query = query.eq('image_path', frameImagePath)
  const { data, error } = await query
  if (error) {
    console.error('listFeedback failed', error)
    return []
  }
  return data as FeedbackRow[]
}

export async function createFeedback(input: {
  frameId: string
  bbox: { x: number; y: number; w: number; h: number }
  note: string
  author?: string
}): Promise<{ ok: boolean; error?: string }> {
  const frame = getFrame(input.frameId)
  if (!frame) return { ok: false, error: `unknown frame ${input.frameId}` }
  if (!input.note.trim()) return { ok: false, error: 'note is required' }

  const { error } = await supabaseAdmin.from('design_feedback').insert({
    project: frame.project,
    iteration_label: frame.iterationLabel,
    frame_label: frame.frameLabel,
    image_path: frame.imagePath,
    bbox: input.bbox,
    note: input.note.trim(),
    author: input.author ?? 'donovan',
    status: 'pending',
  })
  if (error) {
    console.error('createFeedback failed', error)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/** Batch a set of pending rows into one named group and mark them
 * queued — the signal that they're ready for a Claude session to
 * pick up and work through together, rather than one subagent per
 * tiny edit. */
export async function queueFeedback(
  ids: string[],
  groupLabel: string
): Promise<{ ok: boolean; error?: string }> {
  if (ids.length === 0) return { ok: false, error: 'no rows selected' }
  const { error } = await supabaseAdmin
    .from('design_feedback')
    .update({ status: 'queued', group_label: groupLabel })
    .in('id', ids)
    .eq('status', 'pending')
  if (error) {
    console.error('queueFeedback failed', error)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

export async function reopenFeedback(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabaseAdmin
    .from('design_feedback')
    .update({ status: 'pending', group_label: null, resolution: null, resolved_at: null })
    .eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Manual override — lets Donovan mark something resolved himself
 * without waiting on a Claude session, e.g. if he just fixed it in
 * the editor directly. */
export async function markResolved(
  id: string,
  resolution: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabaseAdmin
    .from('design_feedback')
    .update({ status: 'resolved', resolution, resolved_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
