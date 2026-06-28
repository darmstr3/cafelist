/**
 * Loop state management.
 *
 * State is stored in loop_runs.state_snapshot of the most recent
 * completed run for a given loop_id. This works in both Vercel and
 * local CLI contexts since both write to Supabase.
 *
 * In local (non-Vercel) mode, state is also mirrored to
 * ops/state/loops/<loop-id>.json for easy offline inspection.
 */

import * as fs from 'fs'
import * as path from 'path'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { LoopState, RunStatus } from './types'

const IS_VERCEL = !!process.env.VERCEL

export function emptyState(loopId: string): LoopState {
  return {
    loop_id: loopId,
    last_run_id: null,
    last_run_at: null,
    last_status: null,
    last_cursor: null,
    custom: {},
  }
}

/** Read the persisted state from the most recent completed loop_runs row. */
export async function readState(
  client: SupabaseClient,
  loopId: string,
): Promise<LoopState> {
  const { data } = await client
    .from('loop_runs')
    .select('run_id, started_at, status, state_snapshot')
    .eq('loop_id', loopId)
    .in('status', ['COMPLETED', 'PARTIAL', 'AWAITING_HUMAN_REVIEW'])
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return emptyState(loopId)

  const snap = (data.state_snapshot ?? {}) as Record<string, unknown>

  return {
    loop_id: loopId,
    last_run_id: data.run_id as string,
    last_run_at: data.started_at as string,
    last_status: data.status as RunStatus,
    last_cursor: snap.last_cursor ?? null,
    custom: (snap.custom as Record<string, unknown>) ?? {},
  }
}

/** Merge a state patch and persist to Supabase + optionally to the local file. */
export async function writeState(
  client: SupabaseClient,
  loopId: string,
  runId: string,
  patch: Record<string, unknown>,
  currentState: LoopState,
): Promise<LoopState> {
  const next: LoopState = {
    ...currentState,
    last_cursor: patch.last_cursor ?? currentState.last_cursor,
    custom: { ...currentState.custom, ...(patch.custom as Record<string, unknown> | undefined ?? {}) },
  }

  // Write to loop_runs.state_snapshot
  await client
    .from('loop_runs')
    .update({ state_snapshot: next as unknown as Record<string, unknown> })
    .eq('run_id', runId)

  // Mirror to local file in non-Vercel mode
  if (!IS_VERCEL) {
    try {
      const stateDir = path.resolve(process.cwd(), 'ops/state/loops')
      if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true })
      const stateFile = path.join(stateDir, `${loopId}.json`)
      fs.writeFileSync(stateFile, JSON.stringify({ ...next, updated_at: new Date().toISOString() }, null, 2))
    } catch {
      // Non-fatal in local mode
    }
  }

  return next
}
