import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const config = read('supabase/config.toml');
const run37 = read('supabase/migrations/Run37_final_operational_database_completion.sql');
const verify = read('supabase/verify/Verify_Final_Database_Clearance.sql');
const geo = read('supabase/functions/_shared/geoProxy.ts');
const telemetry = read('supabase/functions/record-auth-event/index.ts');
const reset = read('supabase/functions/request-password-reset/index.ts');
const backupUi = read('src/features/platform/SuperAdminPage.jsx');
const backupGui = read('tools/backup_assistant/backup_assistant.py');
const authService = read('src/services/authService.js');

test('JWT policy is per-function: pre-auth and webhook endpoints are public-gateway, admin endpoints require JWT', () => {
  for (const fn of ['auth-security-gate','record-auth-event','request-password-reset','telegram-bot-webhook','telegram-notification-dispatch']) {
    assert.match(config, new RegExp(`\\[functions\\.${fn}\\]\\s*verify_jwt = false`));
  }
  for (const fn of ['admin-delete-unlinked-user','admin-temporary-password','complete-temporary-password']) {
    assert.match(config, new RegExp(`\\[functions\\.${fn}\\]\\s*verify_jwt = true`));
  }
});

test('Run37 atomically consumes signed Worker nonces and validates a live Auth session for login-success telemetry', () => {
  assert.match(run37, /private\.hl_geo_proxy_nonces/);
  assert.match(run37, /ON CONFLICT\(nonce\) DO NOTHING/);
  assert.match(run37, /hl_consume_geo_proxy_nonce\(uuid,timestamptz\)/);
  assert.match(run37, /hl_is_auth_session_active_for_security_event\(uuid,uuid\)/);
  assert.match(run37, /DROP TRIGGER IF EXISTS hl_activity_log_retention_30d/);
  assert.match(run37, /DROP TRIGGER IF EXISTS hl_security_log_retention_30d/);
  assert.match(verify, /geo nonce RPC is service-role-only/);
  assert.match(verify, /per-insert cleanup triggers removed after scheduling/);
});

test('Worker metadata fails closed on replay/store outage and unsigned City/Region is not persisted', () => {
  assert.match(geo, /GEO_PROXY_NONCE_STORE_UNAVAILABLE/);
  assert.match(geo, /GEO_PROXY_NONCE_REPLAYED_OR_EXPIRED/);
  assert.match(geo, /consumeNonce\(nonce, timestamp\)/);
  assert.match(geo, /city: null,[\s\S]*region: null,[\s\S]*regionCode: null/);
});

test('Public telemetry cannot forge login success or password-reset-requested events', () => {
  assert.match(telemetry, /admin\.auth\.getUser\(jwt\)/);
  assert.match(telemetry, /hl_is_auth_session_active_for_security_event/);
  const publicTypes = telemetry.match(/const PUBLIC_EVENT_TYPES = new Set\(\[([\s\S]*?)\]\);/)?.[1] || '';
  assert.doesNotMatch(publicTypes, /login_success|password_reset_requested/);
  assert.match(reset, /p_event_type: 'password_reset_requested'/);
});

test('Password Reset email validator is present and Localhost aliases are supported', () => {
  assert.match(reset, /function isValidEmail\(value: unknown\): value is string/);
  assert.match(reset, /email\.length >= 5 && email\.length <= 254/);
  assert.ok(reset.includes("'http://127.0.0.1:5173'"));
  assert.ok(read('supabase/functions/auth-security-gate/index.ts').includes("'http://127.0.0.1:5173'"));
});

test('Backup UI links the downloaded .hlbackup to the local Restore & Recovery file picker', () => {
  assert.match(backupUi, /ডাউনলোড করা `\.hlbackup` এই Web Panel-এ Upload হবে না/);
  assert.match(backupUi, /Restore & Recovery/);
  assert.match(backupUi, /RUN_BACKUP_ASSISTANT\.bat/);
  assert.match(backupGui, /\.hlbackup নির্বাচন করুন/);
  assert.match(backupGui, /filedialog\.askopenfilename/);
});

test('Cloudflare Geo Proxy is optional and Direct Supabase mode is not blocked by a missing Worker', () => {
  assert.doesNotMatch(geo, /HOSTEL_GEO_PROXY_REQUIRED|GEO_PROXY_REQUIRED/);
  assert.match(geo, /Direct-to-Supabase and signed Worker requests use trusted IP only/);
  assert.match(geo, /proxyMarker === 'v1'/);
});

test('Password re-authentication does not inflate the fresh login-success metric', () => {
  const verifyBlock = authService.match(/export async function verifyPassword\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(verifyBlock, /recordLoginSuccess: false/);
  assert.match(authService, /result\.data\?\.user && recordLoginSuccess/);
});

test('optional Geo/IP guard failures do not prevent Supabase Authentication', () => {
  assert.match(authService, /Optional IP\/email security gate unavailable/i);
  assert.doesNotMatch(authService, /GEO_PROXY_REQUIRED|SECURITY_GATE_UNAVAILABLE/);
});
