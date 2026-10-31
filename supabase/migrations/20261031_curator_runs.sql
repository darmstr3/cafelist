-- curator_runs: telemetry + overlap guard for the Curator agent (2026-10-31)
--
-- PROBLEM: src/lib/curator.ts's runCurator() (wired into Vercel Cron via
-- src/app/api/curate/route.ts, PR #22) had no protection against two
-- invocations running at once — a manual "run curator now" trigger
-- overlapping the daily cron, a Vercel Cron retry, etc. Concurrent runs
-- could both score and write the same rows (wasted LLM spend, redundant
-- writes) with nothing to detect or prevent it.
--
-- Note scout_runs (20260514_scout_agent.sql) has the identical gap today —
-- it's pure telemetry (an unconditional INSERT with no "is one already
-- running?" check). This migration does NOT fix scout_runs; it only adds
-- the equivalent table + guard for the Curator, which is what's actually
-- being enabled right now. Scout's gap is a separate, pre-existing issue,
-- flagged but out of scope here, bounded somewhat by its own cost caps.
--
-- FIX: curator_runs is both the telemetry table (mirrors scout_runs'
-- shape/conventions) AND the lock itself. The lock is a partial unique
-- index on (status) WHERE status = 'running' — at most one 'running' row
-- can ever exist. Acquiring the lock is a plain INSERT ... status='running';
-- if one is already in flight, the unique index rejects the insert with a
-- real Postgres constraint violation (atomic, race-free — no reliance on
-- a session-held advisory lock, which wouldn't survive PostgREST/pgbouncer
-- transaction pooling anyway).
--
-- Self-healing from crashes: runCurator() sweeps any 'running' row older
-- than CURATOR_LOCK_STALE_MINUTES (see src/lib/curator.ts) to 'error'
-- before attempting to acquire, so a run that died mid-flight (hard
-- Vercel timeout, process crash) without reaching its own finally-block
-- cleanup doesn't permanently wedge the lock.

create table if not exists public.curator_runs (
  run_id         uuid primary key default gen_random_uuid(),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         text not null default 'running'
                   check (status in ('running', 'success', 'partial', 'cap_hit', 'error')),
  processed      integer not null default 0,
  updated        integer not null default 0,
  failed         integer not null default 0,
  cost_usd       numeric(8,4) not null default 0,
  cost_cap_usd   numeric(8,4),
  dry_run        boolean not null default false,
  error_message  text
);

create index if not exists idx_curator_runs_started_at
  on public.curator_runs (started_at desc);

-- The lock: only one 'running' row can exist at a time.
create unique index if not exists idx_curator_runs_one_running
  on public.curator_runs (status)
  where status = 'running';

comment on table public.curator_runs is
  'Telemetry + overlap guard for the Curator agent (src/lib/curator.ts). The partial unique index idx_curator_runs_one_running is the actual lock: acquiring it is an INSERT with status=''running'', which Postgres rejects if one is already in flight. A stale running row (dead process) is swept to ''error'' by the caller before it attempts to acquire, so a crash cannot wedge the lock past CURATOR_LOCK_STALE_MINUTES.';

-- RLS: admin/service-role only, same convention as scout_runs. No public
-- read policy — the anon key can't list runs; the service-role used by
-- scripts/curate-workability.ts and api/curate/route.ts bypasses RLS.
alter table public.curator_runs enable row level security;
