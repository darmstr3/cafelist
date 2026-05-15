-- ============================================================
-- WorkSpot: Schema
-- ============================================================

-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- SPOTS
-- ============================================================
CREATE TABLE spots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('coffee_shop','hotel_lobby','diner','bar','library','coworking','other')),

  -- Location
  address         TEXT NOT NULL,
  city            TEXT NOT NULL,
  neighborhood    TEXT,
  lat             DECIMAL(9,6),
  lng             DECIMAL(9,6),
  google_place_id TEXT,

  -- Media
  photos          JSONB DEFAULT '[]'::jsonb,   -- array of { url, caption }

  -- Hours: { monday: { open: "08:00", close: "23:00" } | null, ... }
  hours           JSONB,

  -- Computed scores (0–10, updated from review aggregates)
  work_score        DECIMAL(3,1) DEFAULT 0,
  late_night_score  DECIMAL(3,1) DEFAULT 0,
  wifi_score        DECIMAL(3,1) DEFAULT 0,
  outlet_score      DECIMAL(3,1) DEFAULT 0,
  noise_score       DECIMAL(3,1) DEFAULT 0,
  seating_score     DECIMAL(3,1) DEFAULT 0,

  -- Boolean amenities
  has_wifi          BOOLEAN DEFAULT TRUE,
  has_outlets       BOOLEAN DEFAULT TRUE,
  laptop_friendly   BOOLEAN DEFAULT TRUE,
  has_bathroom      BOOLEAN DEFAULT TRUE,
  has_food          BOOLEAN DEFAULT TRUE,
  has_drinks        BOOLEAN DEFAULT TRUE,

  -- Qualitative attributes
  noise_level       TEXT CHECK (noise_level IN ('silent','quiet','moderate','loud')),
  seating_comfort   TEXT CHECK (seating_comfort IN ('poor','fair','good','excellent')),

  -- Tags array: e.g. ['cozy', 'industrial', 'outdoor seating', '24hr']
  vibe_tags         TEXT[] DEFAULT '{}'::TEXT[],

  -- Notes from submitter
  notes             TEXT,

  -- Moderation
  status            TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  submitted_by      TEXT,

  -- Curator Agent output (see scripts/curate-workability.ts).
  -- workability_score is "can a remote worker camp here 2+ hours" (0–10),
  -- which is distinct from work_score (review-aggregate of wifi/outlets/seating).
  -- workability_scored_at lets the curator re-score stale rows (>90 days).
  workability_score      NUMERIC(3,1) CHECK (workability_score IS NULL OR (workability_score >= 0 AND workability_score <= 10)),
  workability_reasoning  TEXT,
  workability_scored_at  TIMESTAMPTZ,

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_spots_google_place_id ON spots(google_place_id) WHERE google_place_id IS NOT NULL;
CREATE INDEX idx_spots_city      ON spots(city);
CREATE INDEX idx_spots_status    ON spots(status);
CREATE INDEX idx_spots_type      ON spots(type);
CREATE INDEX idx_spots_lat_lng   ON spots(lat, lng);
CREATE INDEX idx_spots_workability_score ON spots(workability_score) WHERE workability_score IS NOT NULL;

-- ============================================================
-- REVIEWS
-- ============================================================
CREATE TABLE reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spot_id         UUID NOT NULL REFERENCES spots(id) ON DELETE CASCADE,

  author_name     TEXT DEFAULT 'Anonymous',
  author_email    TEXT,

  -- Ratings 1–5
  wifi_rating         SMALLINT CHECK (wifi_rating BETWEEN 1 AND 5),
  outlet_rating       SMALLINT CHECK (outlet_rating BETWEEN 1 AND 5),
  noise_rating        SMALLINT CHECK (noise_rating BETWEEN 1 AND 5),
  seating_rating      SMALLINT CHECK (seating_rating BETWEEN 1 AND 5),
  late_night_rating   SMALLINT CHECK (late_night_rating BETWEEN 1 AND 5),

  comment         TEXT,
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),

  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reviews_spot_id ON reviews(spot_id);
CREATE INDEX idx_reviews_status  ON reviews(status);

-- ============================================================
-- FUNCTION: auto update spots.updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER spots_updated_at
  BEFORE UPDATE ON spots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- FUNCTION: recalculate spot scores after review insert/update
-- ============================================================
CREATE OR REPLACE FUNCTION recalculate_spot_scores()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE spots SET
    wifi_score       = (SELECT COALESCE(AVG(wifi_rating::DECIMAL) * 2, 0)        FROM reviews WHERE spot_id = NEW.spot_id AND status = 'approved'),
    outlet_score     = (SELECT COALESCE(AVG(outlet_rating::DECIMAL) * 2, 0)      FROM reviews WHERE spot_id = NEW.spot_id AND status = 'approved'),
    noise_score      = (SELECT COALESCE(AVG(noise_rating::DECIMAL) * 2, 0)       FROM reviews WHERE spot_id = NEW.spot_id AND status = 'approved'),
    seating_score    = (SELECT COALESCE(AVG(seating_rating::DECIMAL) * 2, 0)     FROM reviews WHERE spot_id = NEW.spot_id AND status = 'approved'),
    late_night_score = (SELECT COALESCE(AVG(late_night_rating::DECIMAL) * 2, 0)  FROM reviews WHERE spot_id = NEW.spot_id AND status = 'approved'),
    work_score       = (SELECT COALESCE(
                          (AVG(wifi_rating) + AVG(outlet_rating) + AVG(seating_rating)) / 3.0 * 2, 0
                        ) FROM reviews WHERE spot_id = NEW.spot_id AND status = 'approved')
  WHERE id = NEW.spot_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reviews_recalculate
  AFTER INSERT OR UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION recalculate_spot_scores();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE spots   ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- Public can read approved spots
CREATE POLICY "spots_public_read"  ON spots   FOR SELECT USING (status = 'approved');
-- Public can insert (submit a spot)
CREATE POLICY "spots_public_insert" ON spots  FOR INSERT WITH CHECK (true);

-- Public can read approved reviews
CREATE POLICY "reviews_public_read"   ON reviews FOR SELECT USING (status = 'approved');
-- Public can insert reviews
CREATE POLICY "reviews_public_insert" ON reviews FOR INSERT WITH CHECK (true);

-- Service role (admin) bypasses RLS automatically


-- ============================================================
-- AGENT_QUERY_LOGS
-- Append-only log of every /labs agent run. Powers the
-- coverage-gap agent and any later analytics on what users
-- are actually asking for.
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_query_logs (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query                  TEXT NOT NULL,
  parsed_intent          JSONB,
  city                   TEXT,
  neighborhood           TEXT,
  top_pick_spot_id       UUID REFERENCES spots(id) ON DELETE SET NULL,
  recommendation_summary TEXT,
  picks_count            INT NOT NULL DEFAULT 0,
  quality_score          NUMERIC(3,1),
  evaluation_pass        BOOLEAN,
  -- 'ok' | 'no_data_in_db' | 'closed_too_early' | 'too_loud'
  -- | 'no_candidates' | 'fatal_error' | 'low_quality'
  failure_mode           TEXT,
  run_id                 TEXT,
  total_duration_ms      INT,
  total_cost_usd         NUMERIC(10,6),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_query_logs_created_at
  ON agent_query_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_query_logs_city_neighborhood
  ON agent_query_logs(city, neighborhood);
CREATE INDEX IF NOT EXISTS idx_agent_query_logs_failure_mode
  ON agent_query_logs(failure_mode);

ALTER TABLE agent_query_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- SCOUT_PRIORITY
-- Acquisition queue for the Scout agent. Two producers:
--   1. Hardcoded seeds (source='seed') — bootstrapped manually.
--   2. The coverage-gap agent (source='coverage_gap') — derived
--      from real /labs query patterns; expires after 30 days.
-- ============================================================
CREATE TABLE IF NOT EXISTS scout_priority (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city            TEXT NOT NULL,
  neighborhood    TEXT,
  priority_score  NUMERIC(10,4) NOT NULL DEFAULT 0,
  source          TEXT NOT NULL DEFAULT 'seed'
                  CHECK (source IN ('seed','hardcoded','coverage_gap','manual')),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS scout_priority_unique_active
  ON scout_priority(city, COALESCE(neighborhood, ''), source);
CREATE INDEX IF NOT EXISTS idx_scout_priority_score
  ON scout_priority(priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_scout_priority_expires
  ON scout_priority(expires_at);

ALTER TABLE scout_priority ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- /LABS EVAL INFRASTRUCTURE
--
-- Three tables capture every `npm run eval` invocation:
--   agent_eval_cases    — the fixture catalogue (slow-changing)
--   agent_eval_runs     — one row per run, with prompt hashes
--   agent_eval_results  — one row per (run, case), with full trace
--
-- The /labs/eval dashboard reads from these tables; the migration
-- of record lives in supabase/migrations or applied via MCP.
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_eval_cases (
  case_id          TEXT PRIMARY KEY,                  -- slug, e.g. "manhattan-after-6pm-quiet"
  query            TEXT NOT NULL,
  hard_constraints JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags             TEXT[] NOT NULL DEFAULT '{}'::text[],
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_eval_cases_active
  ON agent_eval_cases(case_id) WHERE retired_at IS NULL;

CREATE TABLE IF NOT EXISTS agent_eval_runs (
  run_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ,
  git_sha          TEXT,
  prompt_versions  JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_cases      INT NOT NULL DEFAULT 0,
  total_pass       INT NOT NULL DEFAULT 0,
  avg_quality      NUMERIC(4,2) NOT NULL DEFAULT 0,
  total_cost_usd   NUMERIC(10,6) NOT NULL DEFAULT 0,
  note             TEXT
);

CREATE INDEX IF NOT EXISTS idx_eval_runs_started
  ON agent_eval_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS agent_eval_results (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              UUID NOT NULL REFERENCES agent_eval_runs(run_id) ON DELETE CASCADE,
  case_id             TEXT NOT NULL REFERENCES agent_eval_cases(case_id) ON DELETE CASCADE,
  pass_deterministic  BOOLEAN NOT NULL DEFAULT FALSE,
  pass_judge          BOOLEAN,
  quality_score       NUMERIC(4,2),
  latency_ms          INT NOT NULL DEFAULT 0,
  cost_usd            NUMERIC(10,6) NOT NULL DEFAULT 0,
  deterministic_fails JSONB NOT NULL DEFAULT '[]'::jsonb,
  full_trace          JSONB NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(run_id, case_id)
);

CREATE INDEX IF NOT EXISTS idx_eval_results_run
  ON agent_eval_results(run_id);
CREATE INDEX IF NOT EXISTS idx_eval_results_case
  ON agent_eval_results(case_id, created_at DESC);

ALTER TABLE agent_eval_cases   ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_eval_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_eval_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eval_cases_public_read"   ON agent_eval_cases   FOR SELECT USING (true);
CREATE POLICY "eval_runs_public_read"    ON agent_eval_runs    FOR SELECT USING (true);
CREATE POLICY "eval_results_public_read" ON agent_eval_results FOR SELECT USING (true);
