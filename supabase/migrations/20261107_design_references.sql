-- ============================================================
-- design_references: a small, growing library of outside sites
-- used as design benchmarks during critique sessions (see
-- /admin/critique). Seeded with the two references already cited
-- in conversation with Donovan.
-- ============================================================
-- Admin-only, no RLS — same posture as design_feedback.

CREATE TABLE IF NOT EXISTS design_references (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  url         TEXT NOT NULL UNIQUE,
  image_path  TEXT,                 -- e.g. /references/nomads.jpg; null if no screenshot yet
  note        TEXT NOT NULL,
  added_by    TEXT NOT NULL DEFAULT 'donovan',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO design_references (name, url, image_path, note, added_by)
VALUES
  (
    'Nomad List',
    'https://nomads.com',
    '/references/nomads.jpg',
    'Donovan''s own pick for "favorite webapp." Dark background, a live map of people as the entire homepage, playful/casual copy voice, gamified S-Tier polls. Cited as the aliveness reference Signature pass v1 was built toward and still fell short of.',
    'donovan'
  ),
  (
    'Puzzably',
    'https://puzzably.com',
    '/references/puzzably.jpg',
    'Cited when Donovan said CafeList''s designs lacked imagination. Soft pastel gradient background, confident oversized serif headline, real angled product photography instead of flat icons, warm lifestyle framing throughout.',
    'donovan'
  )
ON CONFLICT (url) DO NOTHING;
