-- ROLLBACK for 20261031_outlet_status_and_data_confidence.sql
--
-- Undoes, in reverse order, everything that migration does:
--   3. drop spot_corrections
--   2. drop data_confidence (+ its index)
--   1. drop outlet_status (+ its index)
--
-- NOTE: has_outlets was overwritten in step 1 of the forward migration to
-- match outlet_status (true iff outlet_status='confirmed_yes'). This
-- rollback does NOT attempt to restore has_outlets to its pre-migration
-- values, because the forward migration's own backfill only ever SETS
-- has_outlets=true where outlet_status says confirmed_yes, which (per the
-- before/after counts in the forward migration's header) is a strict
-- superset of rows that already had has_outlets=true — i.e. the only rows
-- this could have changed are has_outlets=false rows that stayed
-- has_outlets=false (outlet_status='unknown' or 'confirmed_no' default to
-- false), OR a row with has_outlets=false that got a real enrichment
-- signal and flipped to true (1 row in production as of 2026-10-31, the
-- 'rare'-outlets spot). If you need that one row reverted to has_outlets=
-- false specifically, do it by hand — this rollback intentionally does not
-- guess which row(s) that affects at rollback time, since outlet_status
-- (which would tell you) is dropped by this same script if run in order.
--
-- NOT APPLIED — prepared for review only, alongside the forward migration.

-- ── 3. spot_corrections ────────────────────────────────────────

drop table if exists public.spot_corrections;

-- ── 2. data_confidence ─────────────────────────────────────────

drop index if exists public.idx_spots_data_confidence;

alter table public.spots
  drop column if exists data_confidence;

-- ── 1. outlet_status ───────────────────────────────────────────

drop index if exists public.idx_spots_outlet_status;

comment on column public.spots.has_outlets is null;

alter table public.spots
  drop column if exists outlet_status;
