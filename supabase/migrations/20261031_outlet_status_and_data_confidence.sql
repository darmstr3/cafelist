-- Outlet tri-state + data confidence + corrections queue (2026-10-31)
--
-- PROBLEM: `has_outlets` is a plain boolean whose column default is `false`.
-- ~85 of 176 approved rows have never actually been checked for outlets —
-- `false` there means "never confirmed", not "confirmed absent" — but the
-- UI (SpotCard, SpotEditPanel, curator prompt) and every WHERE has_outlets=…
-- filter treat it as a hard fact. Same failure shape as the work_score=0
-- bug fixed in lib/spots.ts this same pass: a default value silently reads
-- as a negative answer.
--
-- FIX: add `outlet_status` (confirmed_yes / confirmed_no / unknown) as the
-- source of truth, backfilled from CURRENT data (has_outlets, plus the
-- Scout enrichment pipeline's `enrichment_signals->'outlets'` heuristic
-- where it carries a real signal). `has_outlets` stays as a column —
-- removing it would break every existing filter/read in one migration —
-- but becomes a derived display convenience: true only when
-- outlet_status = 'confirmed_yes'. Going forward, anything writing outlet
-- data should write outlet_status (and let has_outlets follow it), not the
-- other way around.
--
-- Also adds `data_confidence` (verified / inferred / unknown), computed
-- from how fresh last_verified_at / enriched_at / workability_scored_at
-- are, using the same 90-day staleness window the curator itself already
-- uses (scripts/curate-workability.ts STALENESS_DAYS). Read-only
-- production query at migration-write time (2026-10-31) found every
-- approved row's workability_scored_at and enriched_at dated May/June
-- 2026 — i.e. already past that 90-day window — so this backfill currently
-- assigns 0 rows 'verified' and all 176 'inferred'. That's an honest
-- reflection of the known, separately-tracked staleness problem (0/176
-- current on the curator's gate), not a bug in this migration.
--
-- Also creates `spot_corrections`: a review queue for anything below
-- `verified` confidence. Convention going forward: any enrichment/
-- verification pass proposes changes here instead of UPDATE-ing `spots`
-- directly, unless it has `verified`-grade evidence. No UI yet — this is
-- the table + convention only.
--
-- PRODUCTION BEFORE/AFTER (read-only SELECT against ztvyuuvbxofumnyobxcs,
-- run before writing this migration; 176 approved rows total):
--   outlet_status:
--     confirmed_yes: 36  (35 where has_outlets=true, +1 where has_outlets=
--                         false but enrichment_signals->'outlets' carried a
--                         real presence signal — value='rare', confidence
--                         0.9 — rather than 'unknown')
--     confirmed_no:   0  (no row's enrichment signal currently asserts
--                         confirmed absence; nothing today would move into
--                         this bucket, but the CASE handles it for any
--                         future enrichment pass that writes one)
--     unknown:      140  (has_outlets=false with no real signal — either no
--                         enrichment_signals row at all (82), or an
--                         enrichment_signals->'outlets' value of literally
--                         'unknown' (58))
--   data_confidence:
--     verified:   0   (would require last_verified_at within 90 days — none
--                      do; all stamps are from 2026-05-25)
--     inferred: 176   (every approved row has at least a workability_scored_at)
--     unknown:    0
--
-- Re-verify at apply time with:
--   select outlet_status, count(*) from spots where status='approved' group by 1;
--   select data_confidence, count(*) from spots where status='approved' group by 1;
--
-- NOT APPLIED — prepared for review only. See the companion
-- 20261031_outlet_status_and_data_confidence_ROLLBACK.sql for how to undo it.

-- ── 1. outlet_status ───────────────────────────────────────────

alter table public.spots
  add column if not exists outlet_status text
  check (outlet_status in ('confirmed_yes', 'confirmed_no', 'unknown'));

-- Backfill from CURRENT data. Order of the CASE matters: an explicit
-- has_outlets=true always wins (it's the strongest existing signal, even
-- though it's "only" a boolean), then a real (non-'unknown') enrichment
-- signal, then default to 'unknown'.
update public.spots
set outlet_status = case
  when has_outlets = true then 'confirmed_yes'
  when has_outlets = false
    and enrichment_signals -> 'outlets' ->> 'value' is not null
    and enrichment_signals -> 'outlets' ->> 'value' not in ('unknown', 'none')
    and coalesce((enrichment_signals -> 'outlets' ->> 'confidence')::numeric, 0) >= 0.5
    then 'confirmed_yes'
  when has_outlets = false
    and enrichment_signals -> 'outlets' ->> 'value' = 'none'
    and coalesce((enrichment_signals -> 'outlets' ->> 'confidence')::numeric, 0) >= 0.5
    then 'confirmed_no'
  else 'unknown'
end
where outlet_status is null;

alter table public.spots
  alter column outlet_status set default 'unknown';

alter table public.spots
  alter column outlet_status set not null;

-- `has_outlets` becomes a derived/display convenience from here on: true
-- only when outlet_status says so. Existing reads (SpotCard chips,
-- .eq('has_outlets', true) filters) keep working unchanged, but future
-- writes should target outlet_status and let this follow, not the reverse.
update public.spots
set has_outlets = (outlet_status = 'confirmed_yes')
where has_outlets <> (outlet_status = 'confirmed_yes');

comment on column public.spots.outlet_status is
  'Tri-state source of truth for outlet presence. confirmed_yes/confirmed_no require real evidence (a direct confirmation or an enrichment_signals->outlets reading at confidence>=0.5); unknown is the honest default. has_outlets is now DERIVED from this column (true iff confirmed_yes) — write outlet_status, not has_outlets.';

comment on column public.spots.has_outlets is
  'Derived display convenience, true iff outlet_status = confirmed_yes. Do not write this directly going forward; write outlet_status instead.';

-- ── 2. data_confidence ─────────────────────────────────────────

alter table public.spots
  add column if not exists data_confidence text
  check (data_confidence in ('verified', 'inferred', 'unknown'));

-- Same 90-day window as scripts/curate-workability.ts's STALENESS_DAYS,
-- so "verified" means the same thing here as it does to the curator.
update public.spots
set data_confidence = case
  when last_verified_at is not null and last_verified_at >= (now() - interval '90 days')
    then 'verified'
  when enriched_at is not null
    or workability_scored_at is not null
    or last_verified_at is not null
    then 'inferred'
  else 'unknown'
end
where data_confidence is null;

alter table public.spots
  alter column data_confidence set default 'unknown';

alter table public.spots
  alter column data_confidence set not null;

comment on column public.spots.data_confidence is
  'verified = confirmed within the last 90 days (last_verified_at); inferred = we have at least one heuristic/LLM-derived signal (enriched_at or workability_scored_at) but it may be stale; unknown = no signal at all. Presentation layer should downgrade a precise one-decimal score to "Not yet verified"-style copy for anything below verified.';

create index if not exists idx_spots_data_confidence
  on public.spots(data_confidence);

create index if not exists idx_spots_outlet_status
  on public.spots(outlet_status);

-- ── 3. spot_corrections: review queue for sub-"verified" changes ─

create table if not exists public.spot_corrections (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.spots(id) on delete cascade,
  field text not null,
  current_value text,
  proposed_value text,
  evidence text,
  source_url text,
  confidence text check (confidence in ('verified', 'inferred', 'unknown')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text
);

create index if not exists idx_spot_corrections_status
  on public.spot_corrections(status, created_at);

create index if not exists idx_spot_corrections_spot_id
  on public.spot_corrections(spot_id);

comment on table public.spot_corrections is
  'Review queue for proposed changes to spots that do not meet "verified" confidence. CONVENTION: any future enrichment/verification pass (Scout, enrich-spots, a Google Places re-fetch, manual research) that produces anything below verified-grade evidence writes a pending row here (spot_id, field, current_value, proposed_value, evidence, source_url, confidence) instead of UPDATE-ing spots directly. Only a verified-grade finding, or an admin approving a pending row here, should ever write to spots. No UI yet — admin review happens by querying this table directly until one exists.';
