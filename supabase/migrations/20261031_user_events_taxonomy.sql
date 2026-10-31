-- Taxonomy v2 for user_events (2026-10-31).
-- Additive only: widens the event_type CHECK so the new client events
-- (cafe_search, filter_apply, cafe_view, directions_click, review_submit)
-- are accepted. No data is modified.
--
-- ORDER: apply this BEFORE deploying feat/analytics-instrumentation.
-- If code ships first, new events 500 at /api/events (fire-and-forget,
-- invisible to users) and are lost — no other impact.
--
-- ROLLBACK: re-run the original constraint (below) — only safe if no rows
-- with new types exist, otherwise DELETE them first.
--   alter table public.user_events drop constraint user_events_event_type_check;
--   alter table public.user_events add constraint user_events_event_type_check
--     check (event_type = any (array['page_view','spot_click','near_me_search',
--       'near_me_result_click','sign_in','sign_out','submit_attempt']));

alter table public.user_events drop constraint if exists user_events_event_type_check;
alter table public.user_events add constraint user_events_event_type_check
  check (event_type = any (array[
    'page_view','spot_click','near_me_search','near_me_result_click',
    'sign_in','sign_out','submit_attempt',
    'cafe_search','filter_apply','cafe_view','directions_click','review_submit'
  ]));

-- No new index: production already has idx_user_events_type on
-- (event_type, created_at desc), which covers the dashboard's queries.
