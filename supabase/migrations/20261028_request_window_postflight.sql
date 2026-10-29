-- Hostel Life October 28 finishing release
-- READ-ONLY: checks installed RPC bodies, not just their names.
-- Run after 20261028_request_window_finishing.sql; it changes no data.
WITH function_sources AS (
  SELECT
    pg_get_functiondef(to_regprocedure('public.create_late_meal_request(date,numeric,numeric,numeric,text)')) AS late_fn,
    pg_get_functiondef(to_regprocedure('public.create_meal_correction_request(date,date,jsonb,uuid)')) AS correction_fn,
    pg_get_functiondef(to_regprocedure('public.edit_my_approved_meal_request(uuid,date,date,jsonb)')) AS edit_fn,
    pg_get_functiondef(to_regprocedure('public.manager_review_correction(uuid,boolean,text)')) AS review_fn
)
SELECT rule, installed
FROM function_sources,
LATERAL (VALUES
  ('Late RPC installed', late_fn IS NOT NULL),
  ('Late 21:00–22:00 gap', COALESCE(position('v_local_now::time >= TIME ''21:00'' AND v_local_now::time < TIME ''22:00''' IN late_fn)>0, false)),
  ('Late date continues after midnight', COALESCE(position('THEN v_today + 1 ELSE v_today' IN late_fn)>0, false)),
  ('Late final/cancelled guard', COALESCE(position('''finalized'',''cancelled''' IN late_fn)>0, false)),
  ('Correction RPC installed', correction_fn IS NOT NULL),
  ('Correction only active due date', COALESCE(position('v_date <> v_target' IN correction_fn)>0, false)),
  ('Correction no finalized day', COALESCE(position('v_day.status = ''finalized''' IN correction_fn)>0, false)),
  ('Direct edit RPC installed', edit_fn IS NOT NULL),
  ('Direct edit 22:00 lock', COALESCE(position('v_date = v_today + 1' IN edit_fn)>0, false)),
  ('Locked day preserved during other edits', COALESCE(position('old_day.value->>''meal_date'')::date = v_today + 1' IN edit_fn)>0, false)),
  ('Manager correction review installed', review_fn IS NOT NULL),
  ('Manager approval protects finalized days', COALESCE(position('v_day.status = ''finalized''' IN review_fn)>0, false))
) AS checks(rule, installed)
ORDER BY rule;
