-- Loop automation tables
-- Tracks every scheduled loop execution: run records, locks, and queue items.
-- Pattern mirrors scout_runs / agent_prompt_runs.

-- ── loop_runs ─────────────────────────────────────────────────────────────────
-- One row per loop execution attempt.
-- state_snapshot: persisted loop state carried into the next run.
-- findings: JSONB array of {severity, code, message, spot_id?, evidence?}.
-- triggered_by: 'cron' | 'manual' | 'cli' | 'retry'

CREATE TABLE IF NOT EXISTS loop_runs (
  run_id           TEXT PRIMARY KEY DEFAULT ('loop-' || gen_random_uuid()::text),
  loop_id          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'QUEUED',
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ,
  dry_run          BOOLEAN NOT NULL DEFAULT FALSE,
  iteration        INTEGER NOT NULL DEFAULT 0,
  items_processed  INTEGER NOT NULL DEFAULT 0,
  items_queued     INTEGER NOT NULL DEFAULT 0,
  maker_summary    TEXT,
  checker_summary  TEXT,
  findings         JSONB,
  state_snapshot   JSONB,
  error            TEXT,
  triggered_by     TEXT NOT NULL DEFAULT 'cron'
);

CREATE INDEX IF NOT EXISTS loop_runs_loop_id_started
  ON loop_runs (loop_id, started_at DESC);

CREATE INDEX IF NOT EXISTS loop_runs_status_active
  ON loop_runs (status)
  WHERE status IN ('RUNNING', 'CHECKING', 'NEEDS_REVISION');

-- ── loop_locks ────────────────────────────────────────────────────────────────
-- Advisory lock table. One row per loop while it is running.
-- Unique constraint on loop_id prevents concurrent runs.
-- expires_at: safety valve — runner checks expiry before treating a lock as held.

CREATE TABLE IF NOT EXISTS loop_locks (
  loop_id      TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL,
  acquired_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL
);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Service-role key bypasses RLS. No additional policies needed for these tables.

COMMENT ON TABLE loop_runs IS 'CafeList automation loop run records. One row per execution.';
COMMENT ON TABLE loop_locks IS 'Advisory locks preventing concurrent loop runs. Row exists = loop is running.';
