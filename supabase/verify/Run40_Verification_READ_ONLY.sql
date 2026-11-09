-- HOSTEL LIFE RUN40 POST-MIGRATION VERIFICATION (READ ONLY)
-- This script checks that the Run40 database objects exist. It does not access member rows.
WITH checks AS (
  SELECT 'function'::text AS kind, 'public.hl_get_final_meal_audit(date)'::text AS item,
    to_regprocedure('public.hl_get_final_meal_audit(date)') IS NOT NULL AS ready
  UNION ALL SELECT 'function','public.hl_consume_signup_otp_resend(text,text,inet,text,text,text,text,text,text)',
    to_regprocedure('public.hl_consume_signup_otp_resend(text,text,inet,text,text,text,text,text,text)') IS NOT NULL
  UNION ALL SELECT 'trigger','market_entries.hl_market_notification_total_upd',EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.market_entries') AND tgname='hl_market_notification_total_upd' AND NOT tgisinternal)
  UNION ALL SELECT 'trigger','ledger_transactions.hl_ledger_notification_ins',EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.ledger_transactions') AND tgname='hl_ledger_notification_ins' AND NOT tgisinternal)
  UNION ALL SELECT 'constraint','hl_security_events_event_type_run40_check',EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('private.hl_security_events') AND conname='hl_security_events_event_type_run40_check' AND convalidated)
  UNION ALL SELECT 'index','hl_security_events_signup_otp_email_idx',to_regclass('private.hl_security_events_signup_otp_email_idx') IS NOT NULL
  UNION ALL SELECT 'index','hl_security_events_signup_otp_ip_idx',to_regclass('private.hl_security_events_signup_otp_ip_idx') IS NOT NULL
)
SELECT kind, item, CASE WHEN ready THEN 'READY' ELSE 'MISSING' END AS status
FROM checks
ORDER BY kind, item;
