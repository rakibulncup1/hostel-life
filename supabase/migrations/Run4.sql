-- OPTIONAL: exact 21:00 Asia/Dhaka finalization requires pg_cron.
-- Bangladesh is UTC+6 year-round, so 21:00 Asia/Dhaka = 15:00 UTC.
-- This file is intentionally safe when pg_cron is unavailable: it reports a NOTICE
-- instead of raising P0001. The app's RPCs still perform lazy finalization.
do $cron_setup$
declare
  v_job_id bigint;
  v_enabled boolean := false;
begin
  select exists(select 1 from pg_catalog.pg_extension where extname = 'pg_cron') into v_enabled;
  if not v_enabled then
    raise notice 'pg_cron is not enabled. No job was created. This is optional; enable Cron in Supabase Dashboard if exact 21:00 Dhaka execution is required.';
    return;
  end if;

  -- Use dynamic SQL so references to cron schema are not parsed when the extension is absent.
  for v_job_id in execute 'select jobid from cron.job where jobname = ''hostel-life-daily-meal-finalization''' loop
    execute format('select cron.unschedule(%s)', v_job_id);
  end loop;
  execute 'select cron.schedule(''hostel-life-daily-meal-finalization'', ''0 15 * * *'', ''select private.finalize_all_running_periods();'')';
  raise notice 'Scheduled hostel-life-daily-meal-finalization at 15:00 UTC (21:00 Asia/Dhaka).';
exception
  when insufficient_privilege then
    raise notice 'pg_cron exists but permission to schedule was denied. Enable/configure Cron from Supabase Dashboard and rerun this file.';
  when undefined_table or invalid_schema_name or undefined_function then
    raise notice 'pg_cron was detected but cron.job/schedule is not available. Configure the Cron extension in Supabase Dashboard.';
end
$cron_setup$;

-- When the extension is available, the NOTICE above confirms job creation.
-- To inspect it afterwards, use Supabase SQL Editor: select jobid, jobname, schedule, active from cron.job where jobname='hostel-life-daily-meal-finalization';
