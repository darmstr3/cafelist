-- ============================================================
-- design_feedback: markup.io-style box feedback for design/admin
-- mockup review, queued for Claude-subagent follow-through.
-- ============================================================
-- Admin-only table (service-role access only, same posture as
-- scout_runs — no RLS policies, never exposed to the anon client).
--
-- A row is one box drawn on one screenshot with a note. Rows get
-- grouped (group_label) and marked 'queued' when Donovan wants a
-- batch picked up; a Claude session resolves them by editing the
-- relevant mockup/code and writing status + resolution back here.
-- This is NOT a fully unattended pipeline — there is no serverless
-- agent runner wired up. Processing happens when a Claude session
-- reads 'queued' rows and acts on them.

CREATE TABLE IF NOT EXISTS design_feedback (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project       TEXT NOT NULL DEFAULT 'cafelist',
  iteration_label TEXT NOT NULL,
  frame_label   TEXT NOT NULL,
  image_path    TEXT NOT NULL,          -- e.g. /critique/r2-venue-mobile.png
  bbox          JSONB NOT NULL,         -- {x, y, w, h} in percent of image
  note          TEXT NOT NULL,
  author        TEXT NOT NULL DEFAULT 'donovan',
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'queued', 'resolved', 'needs_review')),
  group_label   TEXT,
  resolution    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_design_feedback_status
  ON design_feedback (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_design_feedback_iteration
  ON design_feedback (project, iteration_label);
