import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const sql = read('supabase/migrations/Run35_super_admin_security_retention_telegram_sessions.sql');
const page = read('src/features/platform/SuperAdminPage.jsx');
const service = read('src/services/platformService.js');
const auth = read('src/services/authService.js');
const gate = read('supabase/functions/auth-security-gate/index.ts');
const telemetry = read('supabase/functions/record-auth-event/index.ts');
const reset = read('supabase/functions/request-password-reset/index.ts');
const orphan = read('supabase/functions/admin-delete-unlinked-user/index.ts');

 test('Run35 is additive, transactional, bounded by lock/statement timeouts and preflights exact dependencies', () => {
  assert.match(sql, /\nBEGIN;[\s\S]*?SET LOCAL lock_timeout = '5s';[\s\S]*?SET LOCAL statement_timeout = '120s';/);
  for (const relation of ['private.hl_security_events','private.hl_activity_events','private.password_reset_request_log','public.user_notification_channels','public.notification_link_tokens','public.platform_audit_log','public.hl_auth_sessions','private.hl_login_sessions','auth.users','auth.sessions']) {
    assert.ok(sql.includes(`to_regclass('${relation}')`), `missing preflight ${relation}`);
  }
  assert.match(sql, /NOTIFY pgrst/);
  assert.match(sql, /COMMIT;/);
  assert.match(sql, /FOR v_column IN[\s\S]*?required\(schema_name,table_name,column_name\)[\s\S]*?information_schema\.columns/);
  assert.match(sql, /to_regprocedure\('extensions\.digest\(bytea,text\)'\)/);
  assert.match(sql, /data_type='timestamp with time zone'/);
  assert.doesNotMatch(sql, /storage\.objects|storage\.buckets|Logo For Hostel Life/i);
});

test('app-originated failed login/signup threshold is six in one rolling minute and creates a 15-minute IP block', () => {
  assert.match(sql, /event_type IN \('login_failed','signup_failed'\)/);
  assert.match(sql, /v_recent_failed_count >= 5/);
  assert.ok(sql.indexOf('IF v_recent_failed_count >= 5 THEN') < sql.indexOf('IF v_global_count >= 1000 THEN'), 'block must be decided before the telemetry storage cap');
  assert.match(sql, /v_block_until:=v_now\+interval '15 minutes'/);
  assert.match(sql, /hl_security_ip_blocks\(scope,ip_address,block_reason,country_code/);
  assert.match(sql, /FUNCTION public\.hl_check_auth_ip_block\(p_request_ip inet\)/);
});

test('password reset email quota is 2 per Dhaka day and 5 per Dhaka calendar month', () => {
  assert.match(sql, /v_local_now:=v_now AT TIME ZONE 'Asia\/Dhaka'/);
  assert.match(sql, /v_monthly_used>=5/);
  assert.match(sql, /v_daily_used>=2/);
  assert.match(sql, /'daily_limit',2,'monthly_limit',5/);
  assert.match(reset, /PASSWORD_RESET_DAILY_LIMIT/);
  assert.match(reset, /PASSWORD_RESET_MONTHLY_LIMIT/);
});

test('password reset IP gate accepts two requests/hour and blocks the third for one hour', () => {
  assert.match(sql, /hl_password_reset_ip_attempts/);
  assert.match(sql, /requested_at>v_now-interval '1 hour'/);
  assert.match(sql, /IF v_count>2 THEN/);
  assert.match(sql, /v_now\+interval '1 hour'/);
  assert.match(reset, /hl_consume_password_reset_ip_request/);
  assert.match(reset, /PASSWORD_RESET_IP_TEMPORARILY_BLOCKED/);
  assert.match(reset, /if \(!requestIp\)/);
  assert.match(sql, /'reason','client_ip_unavailable'/);
  const config = read('supabase/config.toml');
  assert.match(config, /\[functions\.request-password-reset\][\s\S]*?verify_jwt = false/);
  assert.match(config, /\[functions\.admin-delete-unlinked-user\][\s\S]*?verify_jwt = true/);
});

test('public security gates and ingestion are service-role-only; private attempt tables expose no grants', () => {
  for (const fn of [
    'public.hl_record_public_security_event_v2(text,text,text,inet,text,text,text,text)',
    'public.hl_check_auth_ip_block(inet)',
    'public.hl_consume_password_reset_ip_request(inet,text)',
    'public.consume_password_reset_quota(text)',
  ]) {
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC,anon,authenticated`), `missing revoke: ${fn}`);
    assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION ${fn} TO service_role`), `missing server grant: ${fn}`);
  }
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE private\.hl_security_ip_blocks FROM PUBLIC,anon,authenticated,service_role/);
  assert.match(sql, /REVOKE ALL ON TABLE private\.hl_password_reset_ip_attempts FROM PUBLIC,anon,authenticated,service_role/);
});


test('Security UI discloses direct Auth endpoint bypass and shared-network IP block impact', () => {
  assert.match(page, /সরাসরি Supabase Auth endpoint-এ request পাঠালে এই app gate এড়িয়ে যেতে পারে/);
  assert.match(page, /shared IP সাময়িকভাবে block হতে পারে/);
});

test('Security Monitor exposes success/failure events, country, IP and date-window filters', () => {
  for (const event of ['login_failed','login_success','signup_failed','signup_submitted','password_reset_failed','password_reset_requested']) assert.ok(sql.includes(`'${event}'`));
  assert.match(sql, /p_country_code text DEFAULT NULL/);
  assert.match(sql, /e\.country_code=v_country/);
  assert.match(sql, /e\.created_at>=p_from/);
  assert.match(sql, /e\.created_at<p_to/);
  assert.match(page, /securityFromDate/);
  assert.match(page, /securityToDate/);
  assert.match(page, /Country Code/);
  assert.match(page, /সফল Login/);
  assert.match(page, /Reset email অনুরোধ গ্রহণ/);
  assert.match(sql, /'successful_logins_24h',count\(\*\) FILTER \(WHERE event_type='login_success'/);
});

test('Activity date filters convert Bangladesh-local boundaries and distinguish Audit Log from Activity', () => {
  assert.match(page, /fromDhakaDateTimeInput\(`\$\{activityFromDate\}T00:00`\)/);
  assert.match(page, /fromDhakaDateTimeInput\(`\$\{addCalendarDaysToDateInput\(activityToDate\)\}T00:00`\)/);
  assert.match(page, /fromDhakaDateTimeInput\(`\$\{addCalendarDaysToDateInput\(securityToDate\)\}T00:00`\)/);
  assert.match(page, /platformAdminListActivityV2/);
  assert.match(page, /Audit Log খুলুন/);
  assert.match(sql, /platform_admin_list_activity_v2/);
});

test('Country attribution uses only trusted Cloudflare country header and only two-letter ISO-like codes', () => {
  assert.match(telemetry, /cf-ipcountry/);
  assert.match(telemetry, /p_country_code: countryCode/);
  assert.doesNotMatch(telemetry, /x-forwarded-for/i);
  assert.match(sql, /country_code ~ '\^\[A-Z\]\{2\}\$'/);
});

test('Auth app gate checks trusted Cloudflare IP and refuses to trust arbitrary forwarding headers', () => {
  assert.match(gate, /cf-connecting-ip/);
  assert.match(gate, /hl_check_auth_ip_block/);
  assert.doesNotMatch(gate, /headers\.get\(['"]x-forwarded-for/i);
  assert.match(auth, /checkAppAuthGate\(\)/);
  assert.match(auth, /await checkAppAuthGate\(\)/);
  assert.match(auth, /signInWithPassword/);
  assert.match(auth, /auth\.signUp/);
  assert.match(service, /platformAdminCheckSecurityTelemetry/);
  assert.match(service, /auth-security-gate/);
  assert.match(gate, /direct requests to the public Auth endpoint may bypass it/i);
  assert.match(gate, /CLIENT_IP_UNAVAILABLE/);
  assert.match(auth, /details\?\.code === 'CLIENT_IP_UNAVAILABLE'/);
  assert.match(gate, /const healthIp = trustedProxyIp\(request\)/);
  assert.match(gate, /protection_available: protectionAvailable/);
  assert.doesNotMatch(gate, /hl_check_auth_ip_block', \{ p_request_ip: null \}\);[\s\S]{0,300}protection_available: clientIpAvailable/);
});

test('Telegram management only exposes connection metadata and removes only Telegram rows/tokens', () => {
  assert.match(sql, /platform_admin_list_telegram_connections/);
  assert.match(sql, /'telegram_user_id',c\.provider_user_id/);
  assert.match(sql, /'telegram_username',c\.provider_username/);
  assert.match(sql, /DELETE FROM public\.user_notification_channels WHERE user_id=p_user_id AND provider='telegram'/);
  assert.match(sql, /DELETE FROM public\.notification_link_tokens WHERE user_id=p_user_id/);
  assert.match(sql, /IF NOT private\.is_super_admin\(\) THEN/);
  assert.match(page, /সংযুক্ত ব্যবহারকারীর তালিকা/);
  assert.match(page, /Disconnect/);
});

test('Session directory masks the raw Supabase session ID and revokes exactly one target session', () => {
  assert.match(sql, /'session_ref',pg_catalog\.encode\(extensions\.digest/);
  assert.doesNotMatch(sql, /'session_id',s\.session_id/);
  assert.match(sql, /UPDATE auth\.sessions SET not_after=/);
  assert.match(sql, /revoke_reason='admin_revoked'/);
  assert.match(sql, /নিজের বর্তমান Admin Session/);
  assert.match(sql, /নিজের Admin Session নিরাপদে শনাক্ত করা যায়নি/);
  assert.match(sql, /IF COALESCE\(auth\.jwt\(\)->>'session_id',''\) !~\*/);
  assert.match(page, /সক্রিয় Device Session/);
  assert.match(page, /এই Session বন্ধ করুন/);
  assert.match(page, /আগে ইস্যু হওয়া Access Token তার নির্ধারিত মেয়াদ শেষ হওয়া পর্যন্ত কার্যকর থাকতে পারে/);
});

test('30-day operational-log cleanup never targets business/archive data and documents scheduler limitation', () => {
  assert.match(sql, /DELETE FROM private\.hl_activity_events WHERE created_at<pg_catalog\.now\(\)-interval '30 days'/);
  assert.match(sql, /DELETE FROM private\.hl_security_events WHERE created_at<pg_catalog\.now\(\)-interval '30 days'/);
  assert.match(sql, /CREATE TRIGGER hl_activity_log_retention_30d/);
  assert.match(sql, /CREATE TRIGGER hl_security_log_retention_30d/);
  assert.match(sql, /opportunistic 30-day retention/i);
  assert.doesNotMatch(sql, /DELETE FROM public\.(market_entries|ledger_transactions|daily_meal_records|monthly_periods)/i);
  assert.match(page, /Scheduler না থাকায়/);
  assert.match(page, /Platform Audit Log আলাদা accountability record/);
  assert.match(page, /Password Reset quota হিসাবের HMAC-only row ৩৫ দিন/);
});

test('bulk orphan Auth deletion is capped at 25 and server-rechecks each account before deletion', () => {
  assert.match(orphan, /body\.action === 'delete_many'/);
  assert.match(orphan, /rawIds\.length > 25/);
  assert.match(orphan, /DELETE \$\{ids\.length\} ORPHAN AUTH ACCOUNTS/);
  assert.match(orphan, /select\('id', \{ count: 'exact', head: true \}\)\.eq\('user_id', targetId\)/);
  assert.match(orphan, /target\?\.role === 'super_admin'/);
  assert.match(orphan, /targetId === identity\.user\.id|ids\.includes\(identity\.user\.id\)/);
  assert.match(page, /নির্বাচিতগুলো মুছুন/);
});

test('Run35 new admin RPCs are guarded by signed-in Super Admin checks and public access revoked', () => {
  for (const fn of [
    'platform_admin_list_activity_v2','platform_admin_get_security_overview_v2','platform_admin_list_security_events_v2',
    'platform_admin_list_security_ip_blocks','platform_admin_list_telegram_connections','platform_admin_disconnect_telegram_user',
    'platform_admin_list_active_sessions','platform_admin_revoke_active_session',
  ]) {
    const start = sql.indexOf(`FUNCTION public.${fn}`);
    assert.ok(start >= 0, `missing function ${fn}`);
    const chunk = sql.slice(start, sql.indexOf('$function$;', start) + 11);
    assert.match(chunk, /SECURITY DEFINER/);
    assert.match(chunk, /private\.assert_signed_in\(\)/);
    assert.match(chunk, /private\.is_super_admin\(\)/);
  }
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.platform_admin_revoke_active_session\(uuid,text,text\) FROM PUBLIC,anon/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.platform_admin_revoke_active_session\(uuid,text,text\) TO authenticated/);
});


test('Run35 verification SQL uses valid role checks and remains read-only', () => {
  const verification = read('supabase/verify/Verify_Run35_super_admin_completion.sql');
  assert.match(verification, /SELECT e\.schema_name, e\.table_name/);
  assert.match(verification, /has_function_privilege\('anon'/);
  assert.doesNotMatch(verification, /has_function_privilege\('public'/);
  assert.doesNotMatch(verification, /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE)\s+/i);
});
