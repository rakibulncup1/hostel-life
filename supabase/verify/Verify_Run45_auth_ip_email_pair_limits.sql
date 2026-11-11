-- Run45: read-only post-deployment verification. No writes are performed.
WITH checks AS (
  SELECT 'IP block email fingerprint column' AS check_name,
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_ip_blocks' AND column_name='email_fingerprint' AND is_nullable='NO') THEN 'PASS' ELSE 'FAIL' END AS status,
    'Automatic blocks are keyed by a server-side HMAC of the attempted email.' AS details
  UNION ALL SELECT 'IP block composite primary key',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid='private.hl_security_ip_blocks'::regclass AND c.contype='p'
        AND (SELECT array_agg(a.attname ORDER BY u.ord)
          FROM unnest(c.conkey) WITH ORDINALITY u(attnum,ord)
          JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=u.attnum)
          = ARRAY['scope','ip_address','email_fingerprint']::name[]
    ) THEN 'PASS' ELSE 'FAIL' END,
    'Manual global block uses empty fingerprint; automatic block uses IP + email fingerprint.'
  UNION ALL SELECT 'Password-reset pair fingerprint column',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_password_reset_ip_attempts' AND column_name='email_fingerprint' AND is_nullable='NO') THEN 'PASS' ELSE 'FAIL' END,
    'Password Reset IP quota is scoped to IP + email.'
  UNION ALL SELECT 'Pair-aware auth gate RPC',
    CASE WHEN to_regprocedure('public.hl_check_auth_ip_block_v2(inet,text)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'The gate checks pair-specific and deliberate global manual blocks.'
  UNION ALL SELECT 'Pair-aware security event writer',
    CASE WHEN to_regprocedure('public.hl_record_public_security_event_v5(text,text,text,inet,text,text,text,text,text,text,text,text)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'Failed Login/Registration events increment the IP + email pair counter.'
  UNION ALL SELECT 'Pair-aware Password Reset limiter',
    CASE WHEN to_regprocedure('public.hl_consume_password_reset_ip_request_v3(inet,text,text,text,text,text)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'Existing per-IP threshold is preserved for each email pair.'
  UNION ALL SELECT 'Signup OTP resend limiter',
    CASE WHEN to_regprocedure('public.hl_consume_signup_otp_resend(text,text,inet,text,text,text,text,text,text)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'The existing RPC now counts one IP + email pair and supports NULL IP.'
  UNION ALL SELECT 'Super Admin pair-specific release RPC',
    CASE WHEN to_regprocedure('public.platform_admin_release_security_ip_block_v2(text,text,text)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'AAL2 Super Admin can release one account-pair block without clearing other users on the shared IP.'
  UNION ALL SELECT 'Attempted email remains in private Security Events',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_events' AND column_name='attempt_email') THEN 'PASS' ELSE 'FAIL' END,
    'The raw attempted email remains in the existing private log; the block table stores only a fingerprint.'
  UNION ALL SELECT 'Manual global IP blocks retained',
    CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='private.hl_security_ip_blocks'::regclass AND conname='hl_security_ip_blocks_email_fingerprint_check' AND convalidated) THEN 'PASS' ELSE 'FAIL' END,
    'Empty fingerprint is reserved for intentional manual global IP blocks.'
)
SELECT check_name,status,details FROM checks ORDER BY check_name;

-- Permission checks: no anonymous/authenticated execution for service-only write/check RPCs.
SELECT routine_name,
  CASE WHEN has_function_privilege('anon',to_regprocedure(p.signature),'EXECUTE') THEN 'FAIL' ELSE 'PASS' END AS anon_execute,
  CASE WHEN has_function_privilege('authenticated',to_regprocedure(p.signature),'EXECUTE') THEN 'FAIL' ELSE 'PASS' END AS authenticated_execute,
  CASE WHEN has_function_privilege('service_role',to_regprocedure(p.signature),'EXECUTE') THEN 'PASS' ELSE 'FAIL' END AS service_role_execute
FROM (VALUES
  ('hl_check_auth_ip_block_v2','public.hl_check_auth_ip_block_v2(inet,text)'),
  ('hl_record_public_security_event_v5','public.hl_record_public_security_event_v5(text,text,text,inet,text,text,text,text,text,text,text,text)'),
  ('hl_consume_password_reset_ip_request_v3','public.hl_consume_password_reset_ip_request_v3(inet,text,text,text,text,text)'),
  ('hl_consume_signup_otp_resend','public.hl_consume_signup_otp_resend(text,text,inet,text,text,text,text,text,text)')
) AS p(routine_name,signature)
ORDER BY routine_name;

-- Aggregate counters only. Do not print raw email or IP values in this diagnostic.
SELECT
  count(*) FILTER (WHERE blocked_until > now() AND email_fingerprint='') AS active_global_manual_blocks,
  count(*) FILTER (WHERE blocked_until > now() AND email_fingerprint<>'') AS active_account_pair_blocks,
  count(*) FILTER (WHERE blocked_until <= now() AND block_reason IN ('more_than_5_failed_auth_attempts_per_minute','more_than_2_password_reset_requests_per_hour')) AS expired_legacy_ip_only_blocks
FROM private.hl_security_ip_blocks;
