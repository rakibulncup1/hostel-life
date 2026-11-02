import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const migration = read('supabase/migrations/Run30_corrective_newest_session_wins.sql');
const authContext = read('src/contexts/AuthContext.jsx');
const authPage = read('src/features/auth/AuthPage.jsx');
const platform = read('src/features/platform/SuperAdminPage.jsx');
const service = read('src/services/platformService.js');

function functionSql(name, schema = 'public') {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION ${schema}.${name}`);
  assert.notEqual(start, -1, `Missing ${schema}.${name}`);
  const end = migration.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `Could not find function terminator for ${schema}.${name}`);
  return migration.slice(start, end + 4);
}

test('Run30 is one transaction and backfills existing sessions without revoking them', () => {
  assert.match(migration, /^BEGIN;/m);
  assert.match(migration, /COMMIT;\s*$/);
  assert.match(migration, /INSERT INTO public\.hl_auth_sessions[\s\S]*?FROM auth\.sessions[\s\S]*?ON CONFLICT\(user_id,session_id\) DO NOTHING/);
  assert.match(migration, /No old device is revoked merely because this corrective migration is run/);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+auth\.sessions/i);
  assert.doesNotMatch(migration, /TRUNCATE\s+auth\.sessions/i);
});

test('Current DB authorization accepts registry-active sessions and blocks revoked or expired sessions only', () => {
  const allowed = functionSql('is_current_auth_session_allowed', 'private');
  const assertion = functionSql('assert_signed_in', 'private');
  assert.match(allowed, /public\.hl_auth_sessions/);
  assert.match(allowed, /app_s\.revoked_at IS NULL/);
  assert.match(allowed, /app_s\.expires_at IS NULL OR app_s\.expires_at>now\(\)/);
  assert.match(allowed, /auth\.sessions/);
  assert.doesNotMatch(allowed, /row_number\(\)|position BETWEEN|created_at ASC/);
  assert.match(assertion, /private\.is_current_auth_session_allowed\(\)/);
});

test('A genuinely new session is registered and keeps the newest sessions, not the oldest', () => {
  const enforce = functionSql('hl_enforce_my_session_limit');
  assert.match(enforce, /auth\.jwt\(\)->>'session_id'/);
  assert.match(enforce, /pg_advisory_xact_lock/);
  assert.match(enforce, /IF v_inserted=1 THEN/);
  assert.match(enforce, /ORDER BY \(s\.session_id=v_session\) DESC,s\.registered_at DESC/);
  assert.match(enforce, /r\.position>v_max/);
  assert.match(enforce, /revoke_reason='device_limit'/);
  assert.match(enforce, /'expires_at',v_row\.expires_at/);
});

test('Existing V5 function callers remain compatible while the new timeout is configurable', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.platform_admin_set_max_devices_per_user\(p_limit integer\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.platform_admin_set_session_policy\(p_limit integer,p_timeout_minutes integer\)/);
  assert.match(migration, /session_timeout_minutes integer NOT NULL DEFAULT 0/);
  assert.match(migration, /session_timeout_minutes BETWEEN 0 AND 10080/);
  assert.match(service, /platform_admin_set_session_policy/);
  assert.match(platform, /session_timeout_minutes/);
  assert.match(platform, /নতুন Login এলে সবচেয়ে পুরোনো Session স্বয়ংক্রিয়ভাবে বন্ধ হবে/);
});

test('Super Admin policy update retains the admin current session and expires/revokes excess sessions safely', () => {
  const save = functionSql('platform_admin_set_session_policy');
  assert.match(save, /private\.assert_signed_in\(\)/);
  assert.match(save, /private\.is_super_admin\(\)/);
  assert.match(save, /CASE WHEN p_timeout_minutes=0 THEN NULL ELSE v_now\+make_interval/);
  assert.match(save, /s\.user_id=auth\.uid\(\) AND s\.session_id=v_current_session/);
  assert.match(save, /r\.position>p_limit/);
  assert.match(save, /session_policy_updated/);
});

test('Client checks session status frequently and signs out locally with a clear expiry notice', () => {
  assert.match(authContext, /SESSION_POLICY_CACHE_MS = 15 \* 1000/);
  assert.match(authContext, /setInterval\(heartbeat, 60 \* 1000\)/);
  assert.match(authContext, /sessionExpiryAt/);
  assert.match(authContext, /endCurrentSessionWithNotice/);
  assert.match(authContext, /নিরাপত্তার কারণে আপনার লগইন সেশনের নির্ধারিত সময় শেষ হয়েছে/);
  assert.match(authContext, /signOut\(\{ scope: 'local' \}\)/);
  assert.match(authPage, /role="alertdialog"/);
  assert.match(authPage, /নিরাপত্তার কারণে লগআউট/);
});

test('Expired sessions stay revoked when Super Admin changes the timeout policy', () => {
  const save = functionSql('platform_admin_set_session_policy');
  assert.match(save, /expires_at<=v_now/);
  assert.match(save, /revoke_reason='session_timeout'/);
  assert.match(save, /WHERE revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at<=v_now/);
});

test('Run30 refuses to proceed if the singleton platform policy or required Auth expiry column is missing', () => {
  assert.match(migration, /platform_settings WHERE singleton=true/);
  assert.match(migration, /table_schema='auth' AND table_name='sessions' AND column_name='not_after'/);
});
