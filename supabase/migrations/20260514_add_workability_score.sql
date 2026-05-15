-- 2026-05-14 — Curator Agent: workability scoring
--
-- Adds a per-row "can a remote worker realistically camp here for 2+ hours
-- with a laptop without feeling pressured to leave" score (0–10), separate
-- from the review-derived work_score. Populated by scripts/curate-workability.ts
-- using Claude Haiku over each spot's structured signals.
--
-- workability_scored_at lets the curator re-score rows older than 90 days,
-- and lets the daily scheduled task pick up unscored rows from Scout within 24h.
--
-- Applied to Supabase project `ztvyuuvbxofumnyobxcs` via apply_migration MCP.

ALTER TABLE spots
  ADD COLUMN IF NOT EXISTS workability_score NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS workability_reasoning TEXT,
  ADD COLUMN IF NOT EXISTS workability_scored_at TIMESTAMPTZ;

ALTER TABLE spots
  ADD CONSTRAINT workability_score_range
  CHECK (workability_score IS NULL OR (workability_score >= 0 AND workability_score <= 10));

CREATE INDEX IF NOT EXISTS idx_spots_workability_score
  ON spots(workability_score)
  WHERE workability_score IS NOT NULL;
