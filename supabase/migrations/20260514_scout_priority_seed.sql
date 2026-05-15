-- ============================================================
-- Scout Agent: seed scout_priority with top-20 US remote-work metros
-- ============================================================
-- priority_score is population-weighted, then boosted/dampened by
-- remote-work density (so San Francisco beats Houston even though
-- Houston has more people). The coverage-gap agent will later
-- insert higher-scoring entries from user demand.
--
-- ON CONFLICT keeps reruns idempotent: existing rows for the
-- (city, neighborhood) pair are left untouched so we never clobber
-- a last_scouted_at timestamp.

-- The existing constraint (from prior exploration) only allowed
-- ('seed','coverage_gap','manual'); we standardize on the
-- design-doc values before inserting any rows.
UPDATE scout_priority SET source = 'hardcoded' WHERE source = 'seed';
ALTER TABLE scout_priority DROP CONSTRAINT IF EXISTS scout_priority_source_check;
ALTER TABLE scout_priority
  ADD CONSTRAINT scout_priority_source_check
  CHECK (source IN ('hardcoded', 'coverage_gap'));

INSERT INTO scout_priority (city, neighborhood, priority_score, source, lat, lng, radius_meters)
VALUES
  ('New York City',   'Manhattan',       100.00, 'hardcoded', 40.7831, -73.9712, 12000),
  ('New York City',   'Brooklyn',         95.00, 'hardcoded', 40.6782, -73.9442, 14000),
  ('Los Angeles',     NULL,               95.00, 'hardcoded', 34.0522, -118.2437, 30000),
  ('San Francisco',   NULL,               92.00, 'hardcoded', 37.7749, -122.4194, 12000),
  ('Austin',          NULL,               90.00, 'hardcoded', 30.2672,  -97.7431, 22000),
  ('Chicago',         NULL,               88.00, 'hardcoded', 41.8781,  -87.6298, 22000),
  ('Seattle',         NULL,               88.00, 'hardcoded', 47.6062, -122.3321, 18000),
  ('Boston',          NULL,               85.00, 'hardcoded', 42.3601,  -71.0589, 15000),
  ('New York City',   'Queens',           85.00, 'hardcoded', 40.7282,  -73.7949, 16000),
  ('Denver',          NULL,               82.00, 'hardcoded', 39.7392, -104.9903, 20000),
  ('Portland',        NULL,               80.00, 'hardcoded', 45.5152, -122.6784, 18000),
  ('Washington',      NULL,               80.00, 'hardcoded', 38.9072,  -77.0369, 18000),
  ('Miami',           NULL,               78.00, 'hardcoded', 25.7617,  -80.1918, 20000),
  ('San Diego',       NULL,               78.00, 'hardcoded', 32.7157, -117.1611, 22000),
  ('Atlanta',         NULL,               76.00, 'hardcoded', 33.7490,  -84.3880, 22000),
  ('Philadelphia',    NULL,               75.00, 'hardcoded', 39.9526,  -75.1652, 18000),
  ('Nashville',       NULL,               73.00, 'hardcoded', 36.1627,  -86.7816, 18000),
  ('Minneapolis',     NULL,               72.00, 'hardcoded', 44.9778,  -93.2650, 18000),
  ('New York City',   'Bronx',            70.00, 'hardcoded', 40.8448,  -73.8648, 14000),
  ('New York City',   'Staten Island',    65.00, 'hardcoded', 40.5795,  -74.1502, 14000)
ON CONFLICT (city, COALESCE(neighborhood, '')) DO NOTHING;
