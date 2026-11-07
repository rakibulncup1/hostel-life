import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/Run27_activity_presence_security_monitoring.sql'), 'utf8');
const retentionMigration = fs.readFileSync(path.join(root, 'supabase/migrations/Run35_super_admin_security_retention_telegram_sessions.sql'), 'utf8');
const verification = fs.readFileSync(path.join(root, 'supabase/verify/Run27_read_only_verification.sql'), 'utf8');
const authContext = fs.readFileSync(path.join(root, 'src/contexts/AuthContext.jsx'), 'utf8');
const appShell = fs.readFileSync(path.join(root, 'src/app/AppShell.jsx'), 'utf8');
const authService = fs.readFileSync(path.join(root, 'src/services/authService.js'), 'utf8');
const platformService = fs.readFileSync(path.join(root, 'src/services/platformService.js'), 'utf8');
const adminPage = fs.readFileSync(path.join(root, 'src/features/platform/SuperAdminPage.jsx'), 'utf8');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/record-auth-event/index.ts'), 'utf8');
const edgeConfig = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
const geoProxy = fs.readFileSync(path.join(root, 'supabase/functions/_shared/geoProxy.ts'), 'utf8');

test('Run27 is additive, bounded and avoids destructive business-data operations', () => {
  assert.match(migration, /BEGIN;/);
  assert.match(migration, /COMMIT;/);
  assert.match(migration, /SET LOCAL lock_timeout = '5s'/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS private\.hl_user_presence/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS private\.hl_activity_events/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS private\.hl_login_sessions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS private\.hl_security_events/);
  assert.doesNotMatch(migration, /\b(TRUNCATE|DROP TABLE|DELETE FROM public\.)\b/i);
  assert.match(migration, /90 days/);
});

test('Presence records real login/logout separately from throttled Last Seen', () => {
  assert.match(migration, /FUNCTION public\.hl_record_my_login/);
  assert.match(migration, /FUNCTION public\.hl_record_my_logout/);
  assert.match(migration, /FUNCTION public\.hl_touch_my_presence/);
  assert.match(migration, /interval '10 minutes'/);
  assert.match(migration, /login_count=EXCLUDED\.login_count/);
  assert.match(migration, /ON CONFLICT\(session_id\) DO NOTHING/);
  assert.match(migration, /login_recorded boolean NOT NULL DEFAULT false/);
  assert.match(migration, /WHERE private\.hl_login_sessions\.user_id=v_user_id[\s\S]*?private\.hl_login_sessions\.login_recorded=false/);
  assert.match(migration, /FROM private\.hl_login_sessions WHERE user_id=v_user_id/);
  assert.match(authContext, /event === 'SIGNED_IN'/);
  assert.match(authContext, /hl_record_my_login/);
  assert.match(authContext, /5 \* 60 \* 1000/);
  assert.match(authContext, /hl_touch_my_presence/);
  assert.match(authContext, /hl_record_my_logout/);
});

test('Member-scoped Activity Log is bound to the selected hostel and user', () => {
  assert.match(migration, /platform_admin_get_member_activity_overview\(\s*p_hostel_id uuid,p_user_id uuid/);
  assert.match(migration, /platform_admin_list_member_activity\(\s*p_hostel_id uuid,p_user_id uuid/);
  assert.match(migration, /e\.hostel_id=p_hostel_id AND \(e\.actor_user_id=p_user_id OR e\.subject_user_id=p_user_id\)/);
  assert.match(adminPage, /openMemberActivity\(member\)/);
  assert.match(adminPage, /memberActivityTarget/);
  assert.match(adminPage, /সর্বশেষ সক্রিয়/);
  assert.match(adminPage, /সর্বশেষ প্রবেশ/);
  assert.match(platformService, /platformAdminListMemberActivity/);
});

test('Global Activity Log and Security Monitor are Super Admin-only RPC views', () => {
  assert.match(migration, /platform_admin_list_activity/);
  assert.match(migration, /platform_admin_get_security_overview/);
  assert.match(migration, /platform_admin_list_security_events/);
  assert.match(migration, /IF NOT private\.is_super_admin\(\) THEN/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.hl_record_public_security_event[\s\S]*?FROM PUBLIC,anon,authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.hl_record_public_security_event[\s\S]*?TO service_role/);
  assert.match(adminPage, /Activity & Security/);
  assert.match(adminPage, /Security Monitor/);
});

test('Auth telemetry sends no password or raw email to storage', () => {
  assert.match(authService, /record-auth-event/);
  assert.match(authService, /event_type: eventType/);
  assert.match(migration, /identity_fingerprint text/);
  assert.doesNotMatch(migration, /email text|password text|raw_email/i);
  assert.match(edge, /HMAC/);
  assert.match(edge, /HOSTEL_SECURITY_HMAC_SECRET/);
  assert.doesNotMatch(edge, /body\.password|p_password/);
  assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/);
});

test('Public auth telemetry is origin-limited, event-allowlisted and cannot block Auth', () => {
  assert.match(edgeConfig, /\[functions\.record-auth-event\][\s\S]*?verify_jwt = false/);
  assert.match(edge, /PUBLIC_EVENT_TYPES/);
  assert.match(edge, /ORIGIN_NOT_ALLOWED/);
  assert.match(edge, /resolveTrustedVisitor/);
  assert.match(edge, /resolveTrustedVisitor\(request, 'record-auth-event', consumeGeoNonce\)/);
  assert.match(geoProxy, /request\.headers\.get\('cf-connecting-ip'\)/);
  assert.match(geoProxy, /HMAC/);
  assert.match(edge, /Telemetry failure must never interfere with the actual Supabase Auth flow/);
  assert.match(migration, /v_ip_count >= 60/);
  assert.match(migration, /Some gateway\/auth flows may not expose a trustworthy client IP/);
  assert.match(migration, /IF p_request_ip IS NOT NULL THEN/);
  assert.match(migration, /pg_advisory_xact_lock/);
});

test('Run27 verification is read-only and checks key objects and permissions', () => {
  assert.match(verification, /to_regclass\('private\.hl_activity_events'\)/);
  assert.match(verification, /to_regclass\('private\.hl_login_sessions'\)/);
  assert.match(verification, /to_regprocedure\('public\.platform_admin_list_member_activity/);
  assert.match(verification, /information_schema\.triggers/);
  assert.match(verification, /information_schema\.routine_privileges/);
  assert.doesNotMatch(verification, /^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\b/im);
});

test('Run27 preserves legacy private-schema access while keeping telemetry tables private', () => {
  assert.match(migration, /REVOKE CREATE ON SCHEMA private FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(migration, /REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated/);
  assert.match(verification, /has_schema_privilege\('authenticated','private','USAGE'\)/);
  assert.match(verification, /has_table_privilege\('authenticated','private\.hl_activity_events','SELECT'\)/);
});

test('Presence is interaction-based, throttled heartbeat, and logout-aware', () => {
  assert.match(authContext, /lastInteractionAt/);
  assert.match(authContext, /pointerdown/);
  assert.match(authContext, /visibilityState !== 'hidden'/);
  assert.match(migration, /ls\.last_logout_at IS NULL AND ls\.last_seen_at>=now\(\)-interval '20 minutes'/);
  assert.match(migration, /interval '20 minutes'/);
});

test('Repeated security attempts receive review signals without automatic account blocking', () => {
  assert.match(migration, /ip_attempts_15m/);
  assert.match(migration, /identity_attempts_15m/);
  assert.match(migration, /repeat_failure_ips_24h/);
  assert.match(migration, /THEN 'high'/);
  assert.match(migration, /THEN 'review'/);
  assert.match(adminPage, /উচ্চ পুনরাবৃত্তি/);
  assert.doesNotMatch(migration, /UPDATE public\.profiles SET is_blocked/i);
});

test('Member activity includes Super Admin actions targeting that member', () => {
  assert.match(migration, /target_type'='user'/);
  assert.match(migration, /target_type'='member'/);
  assert.match(migration, /target_type'='hostel'/);
  assert.match(migration, /platform_admin_list_member_activity/);
  assert.match(migration, /avatar_url',p\.avatar_url/);
});

test('Password-reset telemetry remains best effort and password-free', () => {
  assert.match(authService, /password_reset_failed/);
  assert.match(authService, /catch \{/);
  assert.doesNotMatch(authService, /body:\s*\{[^}]*password\s*:/s);
});


test('Profile updates are attached to the activity trigger (updates only)', () => {
  assert.match(migration, /'platform_audit_log','profiles'/);
  assert.match(migration, /CREATE TRIGGER hl_activity_capture AFTER UPDATE ON public\.profiles/);
  assert.match(verification, /profile_update_trigger_installed/);
  assert.match(adminPage, /profiles\.update/);
});

test('Telemetry has both per-IP and global ingestion caps', () => {
  assert.match(migration, /global_telemetry_rate_limited/);
  assert.match(migration, />= 1000/);
  assert.match(migration, /v_ip_count >= 60/);
  assert.match(edge, /resolveTrustedVisitor/);
  assert.match(geoProxy, /cf-connecting-ip/);
  assert.doesNotMatch(geoProxy, /x-forwarded-for/i);
  assert.doesNotMatch(migration, /x-forwarded-for/);
});


test('Successful login records require a genuine Auth session and prefer stored session IP', () => {
  assert.match(migration, /session_id_unavailable/);
  assert.match(migration, /FROM auth\.sessions s/);
  assert.match(migration, /WHERE s\.id=v_session_id AND s\.user_id=v_user_id/);
  assert.match(migration, /duplicate_session/);
});

test('Archive history avoids duplicate activity rows while underlying member actions are logged', () => {
  assert.match(migration, /archive_period_audit is intentionally not double-hooked/);
  assert.match(migration, /'daily_meal_records',[\s\S]*?'meal_requests','market_entries'/);
  assert.match(migration, /'ledger_transactions',[\s\S]*?'khala_money_entries'/);
  assert.doesNotMatch(migration, /WHEN 'archive_period_audit' THEN/);
  assert.match(adminPage, /user_blocked/);
});


test('Member Login History is hostel-scoped and never exposes Auth session UUIDs', () => {
  const start = migration.indexOf('CREATE OR REPLACE FUNCTION public.platform_admin_list_member_sessions(');
  const end = migration.indexOf('CREATE OR REPLACE FUNCTION public.platform_admin_list_member_activity(', start);
  assert.ok(start >= 0 && end > start);
  const rpc = migration.slice(start, end);
  assert.match(rpc, /s\.user_id=p_user_id AND s\.hostel_id=p_hostel_id/);
  assert.match(rpc, /'logged_in_at'/);
  assert.match(rpc, /'last_seen_at'/);
  assert.match(rpc, /'last_logout_at'/);
  assert.match(rpc, /'ip_address'/);
  assert.match(rpc, /'user_agent'/);
  assert.doesNotMatch(rpc, /'session_id'/);
  assert.match(adminPage, /Login History/);
  assert.match(platformService, /platformAdminListMemberSessions/);
  assert.match(verification, /member_sessions_rpc/);
});

test('All interactive password verification flows use monitored sign-in service', () => {
  const profilePage = fs.readFileSync(path.join(root, 'src/features/profile/ProfilePage.jsx'), 'utf8');
  const forcedPasswordPage = fs.readFileSync(path.join(root, 'src/features/auth/ForcedPasswordChange.jsx'), 'utf8');
  assert.match(authService, /export async function verifyPassword/);
  assert.match(profilePage, /verifyPassword\(/);
  assert.match(adminPage, /verifyPassword\(/);
  assert.match(forcedPasswordPage, /verifyPassword\(/);
  assert.doesNotMatch(profilePage + adminPage + forcedPasswordPage, /signInWithPassword\(/);
});

test('Presence heartbeat resumes immediately after a prolonged idle period', () => {
  assert.match(authContext, /const wasIdle = now - lastInteractionAt > 20 \* 60 \* 1000/);
  assert.match(authContext, /if \(wasIdle\) heartbeat\(\)/);
  assert.match(authContext, /setInterval\(verifySessionPolicy, 60 \* 1000\)/);
  assert.match(authContext, /setInterval\(touchPresence, 5 \* 60 \* 1000\)/);
});

test('Security event retention notice explains Run35 interim and Run37 scheduled cleanup', () => {
  assert.match(adminPage, /Run37 সফলভাবে প্রয়োগ হলে দৈনিক Cron/);
  assert.match(retentionMigration, /DELETE FROM private\.hl_security_events WHERE created_at<pg_catalog\.now\(\)-interval '30 days'/);
  assert.match(retentionMigration, /DELETE FROM private\.hl_activity_events WHERE created_at<pg_catalog\.now\(\)-interval '30 days'/);
});


test('Run27 preflight validates the existing production schema before DDL', () => {
  const preflightStart = migration.indexOf('DO $preflight$');
  const firstTableCreate = migration.indexOf('CREATE TABLE IF NOT EXISTS private.hl_user_presence');
  assert.ok(preflightStart >= 0 && firstTableCreate > preflightStart);
  const preflight = migration.slice(preflightStart, firstTableCreate);
  assert.match(preflight, /\('auth\.sessions'\)/);
  assert.match(preflight, /information_schema\.columns/);
  assert.match(preflight, /private\.assert_signed_in\(\)/);
  assert.match(preflight, /private\.is_super_admin\(\)/);
  assert.match(preflight, /RAISE EXCEPTION/);
});

test('Standard app logout closes only the current session; global logout RPC remains available', () => {
  assert.match(migration, /FUNCTION public\.hl_record_my_global_logout/);
  assert.match(migration, /UPDATE private\.hl_login_sessions ls[\s\S]*?WHERE ls\.user_id=v_user_id AND ls\.last_logout_at IS NULL/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.hl_record_my_global_logout\(\) TO authenticated/);
  assert.match(authContext, /rpc\('hl_record_my_logout'\)/);
  assert.match(authContext, /signOut\(\{ scope: 'local' \}\)/);
  assert.doesNotMatch(authContext, /hl_record_my_global_logout/);
  assert.match(appShell, /অন্য ডিভাইসের সেশন চালু থাকবে/);
  assert.match(verification, /global_logout_rpc/);
});

test('HMAC identity and IP fingerprints use separate domains', () => {
  assert.match(edge, /hmacFingerprint\(`identity:\$\{email\}`/);
  assert.match(edge, /hmacFingerprint\(`ip:\$\{ip\}`/);
});

test('Member Login History includes pagination, independent of activity pagination', () => {
  assert.match(adminPage, /memberSessionPage/);
  assert.match(adminPage, /loadMemberSessions/);
  assert.match(adminPage, /memberSessionTotal>20/);
  assert.match(adminPage, /memberSessionPage\+1/);
});


test('Notification delivery is visible per recipient without copying message contents', () => {
  assert.match(migration, /CREATE TRIGGER hl_activity_capture AFTER INSERT ON public\.notifications/);
  assert.match(migration, /'notification\.sent'/);
  assert.match(migration, /recipient_user_id/);
  assert.match(adminPage, /নোটিফিকেশন পাঠানো হয়েছে/);
  const policy = fs.readFileSync(path.join(root, 'src/features/menu/MenuPages.jsx'), 'utf8');
  assert.match(policy, /Activity, Login ও নিরাপত্তা-তথ্য/);
  assert.match(policy, /IP ঠিকানা এবং ডিভাইস\/ব্রাউজারের User-Agent/);
});
