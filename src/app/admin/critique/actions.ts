'use server'

// ─────────────────────────────────────────────────────────────
// Server actions for /admin/critique. Thin wrappers over the
// query modules so the client component never touches Supabase
// directly — the service-role client stays server-only.
// ─────────────────────────────────────────────────────────────

import { revalidatePath } from 'next/cache'
import {
  createFeedback,
  queueFeedback,
  reopenFeedback,
  markResolved,
} from '@/lib/admin/critique-queries'
import { addReference } from '@/lib/admin/reference-queries'

export async function addFeedbackAction(input: {
  frameId: string
  bbox: { x: number; y: number; w: number; h: number }
  note: string
}) {
  const result = await createFeedback(input)
  revalidatePath('/admin/critique')
  return result
}

export async function queueFeedbackAction(ids: string[], groupLabel: string) {
  const result = await queueFeedback(ids, groupLabel)
  revalidatePath('/admin/critique')
  return result
}

export async function reopenFeedbackAction(id: string) {
  const result = await reopenFeedback(id)
  revalidatePath('/admin/critique')
  return result
}

export async function markResolvedAction(id: string, resolution: string) {
  const result = await markResolved(id, resolution)
  revalidatePath('/admin/critique')
  return result
}

export async function addReferenceAction(input: {
  name: string
  url: string
  note: string
}) {
  const result = await addReference(input)
  revalidatePath('/admin/critique')
  return result
}
