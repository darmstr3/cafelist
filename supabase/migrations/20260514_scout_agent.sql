-- ============================================================
-- Scout Agent: scout_runs + scout_priority
-- ============================================================
-- Scout is a recurring agent that proactively discovers new cafes
-- and hotel lobbies in priority cities via the Google Places API
-- and inserts them as pending spots for the Curator to score.
--
-- - scout_priority drives which city to scout next (highest score
--   that hasn't been touched in 7+ days).
-- - scout_runs is the per-run telemetry table (cost, counts, status)
--   so /admin can see what Scout has been doing and the daily-cap
--   logic in scripts/scout.ts can read recent spend.
--
-- NOTE: scout_priority already existed in the project from an
-- earlier exploration, so this migration is additive: it tops up
-- the missing columns (last_scouted_at, lat, lng, radius_meters)
-- rather than dropping/recreating.

-- ── scout_priority (additive) ─────────────────────────────────
ALTER TABLE scout_priority
  ADD COLUMN IF NOT EXISTS last_scouted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lat             NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS lng             NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS radius_meters   INTEGER DEFAULT 25000;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scout_priority_source_check'
  ) THEN
    ALTER TABLE scout_priority
      ADD CONSTRAINT scout_priority_source_check
      CHECK (source IN ('hardcoded', 'coverage_gap'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_scout_priority_city_hood
  ON scout_priority (city, COALESCE(neighborhood, ''));

CREATE INDEX IF NOT EXISTS idx_scout_priority_pick
  ON scout_priority (priority_score DESC, last_scouted_at NULLS FIRST);

DROP TRIGGER IF EXISTS scout_priority_set_updated_at ON scout_priority;
CREATE TRIGGER scout_priority_set_updated_at
  BEFORE UPDATE ON scout_priority
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── scout_runs ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scout_runs (
  run_id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at           TIMESTAMPTZ,
  city                  TEXT,
  neighborhood          TEXT,
  candidates_examined   INTEGER NOT NULL DEFAULT 0,
  candidates_inserted   INTEGER NOT NULL DEFAULT 0,
  total_cost_usd        NUMERIC(8,4) NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'running'
                          CHECK (status IN ('running','success','partial','skipped','error','cap_hit')),
  error_message         TEXT,
  notes                 TEXT
);

CREATE INDEX IF NOT EXISTS idx_scout_runs_started_at
  ON scout_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_scout_runs_city
  ON scout_runs (city, started_at DESC);

-- ── RLS ───────────────────────────────────────────────────────
-- Both tables are admin/service-role only. RLS is enabled with
-- no public-read policy so the anon key can't list them; the
-- service-role used by scripts/scout.ts bypasses RLS.
ALTER TABLE scout_priority ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_runs     ENABLE ROW LEVEL SECURITY;
