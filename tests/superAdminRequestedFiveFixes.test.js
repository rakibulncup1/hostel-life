import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const page = read('src/features/platform/SuperAdminPage.jsx');
const authContext = read('src/contexts/AuthContext.jsx');
const app = read('src/app/App.jsx');
const authService = read('src/services/authService.js');
const telemetry = read('supabase/functions/record-auth-event/index.ts');
const reset = read('supabase/functions/request-password-reset/index.ts');
const migration = read('supabase/migrations/Run38_security_monitor_actor_identity.sql');
const verify = read('supabase/verify/Verify_Run38_security_monitor_actor_identity.sql');
const dateCss = read('src/styles/production-flow-finishing.css');

test('Security Monitor now distinguishes verified successful account identity from failed-attempt fingerprint', () => {
  assert.match(page, /row\.actor_name/);
  assert.match(page, /row\.actor_user_id/);
  assert.match(page, /Email-এর নিরাপদ HMAC reference/);
  assert.match(page, /Event-এর বিস্তারিত দেখুন/);
  assert.match(migration, /actor_user_id uuid/);
  assert.match(migration, /actor_name/);
  assert.match(migration, /hl_security_monitor_writer_health_v1/);
  assert.match(migration, /profiles p WHERE p\.id=e\.actor_user_id/);
});

test('successful login telemetry requires a Supabase Auth-verified bearer token', () => {
  assert.match(telemetry, /eventType === 'login_success'/);
  assert.match(telemetry, /admin\.auth\.getUser\(tokenMatch\[1\]\)/);
  assert.match(telemetry, /hl_record_authenticated_login_v1/);
  assert.match(telemetry, /authenticated_login_writer_ready/);
  assert.match(telemetry, /hl_security_monitor_writer_health_v1/);
  assert.doesNotMatch(telemetry, /ALLOWED_EVENTS = new Set\(\[\s*'login_failed', 'login_success'/);
  assert.match(authService, /headers: \{ Authorization: `Bearer \$\{accessToken\}` \}/);
  assert.match(authService, /trackSuccessfulLogin = true/);
});

test('City/Region are not persisted from unsigned direct Supabase headers', () => {
  assert.match(telemetry, /visitor\.proxyVerified[\s\S]*?city: null, region: null, regionCode: null/);
  assert.match(reset, /visitor\.proxyVerified[\s\S]*?city: null, region: null, regionCode: null/);
  assert.match(reset, /function isValidEmail\(value: unknown\): value is string/);
  assert.match(reset, /if \(!isValidEmail\(body\.email\)\)/);
});

test('notice datetime controls always receive a full row and actions do not squeeze the date input', () => {
  assert.match(page, /platform-datetime-actions/);
  assert.match(dateCss, /\.platform-communications-card \.platform-communications-date-grid\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(dateCss, /\.platform-communications-card \.platform-datetime-control input\s*\{[\s\S]*?width: 100%[\s\S]*?min-height: 48px/);
});

test('Backup Center explains exactly where the .hlbackup restore file is selected', () => {
  assert.match(page, /ডাউনলোড করা Backup File কোথায় Restore করবেন/);
  assert.match(page, /এই Web Panel-এ `.hlbackup` upload করার জায়গা নেই/);
  assert.match(page, /Restore &amp; Recovery/);
  assert.match(page, /প্রথমে Dry Run \/ Target Check/);
  assert.match(page, /RESTORE &lt;Target Project Ref&gt;/);
});

test('login routing waits for identity resolution before deciding the account has no hostel', () => {
  assert.match(authContext, /identityReady/);
  assert.match(authContext, /setIdentityReady\(true\)/);
  assert.match(authContext, /identityRequestSequenceRef\.current !== identityRequestSequence/);
  assert.match(app, /auth\.isAuthenticated && !auth\.identityReady/);
  assert.match(app, /অ্যাকাউন্ট ও মেসের সংযোগ যাচাই হচ্ছে/);
  assert.match(app, /auth\.identityReady, auth\.identityError/);
  assert.match(app, /আপনাকে মেসের ড্যাশবোর্ডে নেওয়া হচ্ছে/);
});

test('Run38 identity migration is additive and keeps the writer service-role-only', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS actor_user_id uuid/);
  assert.match(migration, /ON DELETE SET NULL/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.hl_record_authenticated_login_v1[\s\S]*?FROM PUBLIC,anon,authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.hl_record_authenticated_login_v1[\s\S]*?TO service_role/);
  assert.match(verify, /actor_user_id exists/);
  assert.match(verify, /writer health function is executable by service_role/);
  assert.doesNotMatch(migration, /DELETE FROM public\.|UPDATE public\.|TRUNCATE|DROP TABLE|CASCADE/i);
});
