-- Run23 read-only verification. This query makes no changes.
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS signature,
       position('v_date > v_dhaka_today' IN pg_get_functiondef(p.oid)) > 0 AS blocks_future_only,
       position('TIME ''21:00''' IN pg_get_functiondef(p.oid)) > 0 AS enforces_dhaka_9pm,
       position('private.ensure_period_days' IN pg_get_functiondef(p.oid)) > 0 AS ensures_day_rows,
       position('private.finalize_due_days' IN pg_get_functiondef(p.oid)) > 0 AS lazy_finalizes_due_days,
       position('assert_hostel_manager' IN pg_get_functiondef(p.oid)) > 0 AS manager_permission_check
FROM pg_proc p
WHERE p.oid = 'public.manager_set_meal_entries(jsonb)'::regprocedure;

-- Optional data inspection: current running-period day status in Dhaka.
SELECT (clock_timestamp() AT TIME ZONE 'Asia/Dhaka') AS dhaka_now,
       d.meal_date, d.status, d.finalizes_at,
       (d.finalizes_at <= clock_timestamp()) AS cutoff_has_passed
FROM public.daily_meal_days d
JOIN public.monthly_periods mp ON mp.id=d.period_id
WHERE mp.status='running'
  AND d.meal_date=(clock_timestamp() AT TIME ZONE 'Asia/Dhaka')::date
ORDER BY d.meal_date;
