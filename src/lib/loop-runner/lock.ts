/**
 * Advisory loop lock via Supabase loop_locks table.
 *
 * Acquire: INSERT into loop_locks. Unique PK on loop_id means only one
 * holder per loop. Returns null if lock is already held (and not expired).
 *
 * Expire: If an existing lock has expires_at < NOW(), it is stale (the previous
 * runner crashed). The acquire call deletes the stale row and retries.
 *
 * Release: DELETE WHERE loop_id = ? AND run_id = ? (own lock only).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const LOCK_BUFFER_MS = 30_000 // 30s beyond max_exec_time

export async function acquireLock(
  client: SupabaseClient,
  loopId: string,
  runId: string,
  maxExecTimeMs: number,
): Promise<{ acquired: boolean; reason?: string }> {
  const expiresAt = new Date(Date.now() + maxExecTimeMs + LOCK_BUFFER_MS).toISOString()

  // First attempt: straight insert
  const { error: insertErr } = await client.from('loop_locks').insert({
    loop_id: loopId,
    run_id: runId,
    acquired_at: new Date().toISOString(),
    expires_at: expiresAt,
  })

  if (!insertErr) return { acquired: true }

  // Insert failed — lock exists. Check if it's expired.
  const { data: existing } = await client
    .from('loop_locks')
    .select('run_id, expires_at')
    .eq('loop_id', loopId)
    .maybeSingle()

  if (!existing) {
    // Row disappeared between insert and select — race condition, retry once
    const { error: retryErr } = await client.from('loop_locks').insert({
      loop_id: loopId,
      run_id: runId,
      acquired_at: new Date().toISOString(),
      expires_at: expiresAt,
    })
    if (!retryErr) return { acquired: true }
    return { acquired: false, reason: 'lock held (retry failed)' }
  }

  const expired = new Date(existing.expires_at) < new Date()
  if (!expired) {
    return {
      acquired: false,
      reason: `lock held by run ${existing.run_id}, expires ${existing.expires_at}`,
    }
  }

  // Stale lock — delete and re-insert
  await client.from('loop_locks').delete().eq('loop_id', loopId).eq('run_id', existing.run_id)

  const { error: staleErr } = await client.from('loop_locks').insert({
    loop_id: loopId,
    run_id: runId,
    acquired_at: new Date().toISOString(),
    expires_at: expiresAt,
  })

  if (!staleErr) return { acquired: true }
  return { acquired: false, reason: 'failed to acquire after stale lock cleanup' }
}

export async function releaseLock(
  client: SupabaseClient,
  loopId: string,
  runId: string,
): Promise<void> {
  await client.from('loop_locks').delete().eq('loop_id', loopId).eq('run_id', runId)
}
