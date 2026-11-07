import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const migration = read('supabase/migrations/Run37_final_operational_database_completion.sql');
const verify = read('supabase/verify/Verify_Final_Database_Clearance.sql');
const reset = read('supabase/functions/request-password-reset/index.ts');
const authGate = read('supabase/functions/auth-security-gate/index.ts');
const authTelemetry = read('supabase/functions/record-auth-event/index.ts');
const orphan = read('supabase/functions/admin-delete-unlinked-user/index.ts');
const adminTemp = read('supabase/functions/admin-temporary-password/index.ts');
const completeTemp = read('supabase/functions/complete-temporary-password/index.ts');
const config = read('supabase/config.toml');
const privacy = read('public/privacy-policy.html');
const dbDiagnostic = read('supabase/diagnostics/Diagnose_database_storage_and_postgres_logging.sql');
const logsSummary = read('supabase/diagnostics/LogsExplorer_24h_source_summary.sql');

test('One final Run37 migration preflights pg_cron and all Run35 timestamp dependencies transactionally', () => {
  assert.match(migration, /(?:^|\n)BEGIN;/);
  assert.match(migration, /SET LOCAL lock_timeout = '5s'/);
  assert.match(migration, /SET LOCAL statement_timeout = '120s'/);
  assert.match(migration, /to_regclass\('cron\.job'\)/);
  assert.match(migration, /cron\.schedule\(text,text,text\)/);
  assert.match(migration, /information_schema\.columns/);
  assert.match(migration, /COMMIT;/);
  assert.doesNotMatch(migration, /CREATE EXTENSION|DROP TABLE|TRUNCATE|DELETE FROM public\.|DELETE FROM auth\./i);
});

test('Run37 cleans only aged operational/security metadata and retains canonical Super Admin audit', () => {
  assert.match(migration, /hl_activity_events[\s\S]*?interval '30 days'/);
  assert.match(migration, /hl_security_events[\s\S]*?interval '30 days'/);
  assert.match(migration, /hl_security_ip_blocks[\s\S]*?interval '30 days'/);
  assert.match(migration, /hl_password_reset_ip_attempts[\s\S]*?interval '48 hours'/);
  assert.match(migration, /password_reset_request_log[\s\S]*?interval '35 days'/);
  assert.match(migration, /platform_audit_log_retained_separately/);
  assert.doesNotMatch(migration, /DELETE FROM public\.platform_audit_log/i);
  assert.doesNotMatch(migration, /DELETE FROM public\.(market_entries|ledger_transactions|daily_meal_records|monthly_periods)/i);
});

test('Run37 cleanup uses one advisory lock, prunes geo nonces, and removes the Run35 per-insert sweeps', () => {
  assert.match(migration, /SECURITY DEFINER[\s\S]*?SET search_path = ''/);
  assert.match(migration, /pg_try_advisory_xact_lock\(728194650175::bigint\)/);
  assert.match(migration, /REVOKE ALL ON FUNCTION private\.hl_prune_platform_logs\(\) FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /DELETE FROM private\.hl_geo_proxy_nonces[\s\S]*?expires_at < v_now/);
  assert.match(migration, /DROP TRIGGER IF EXISTS hl_activity_log_retention_30d/);
  assert.match(migration, /DROP TRIGGER IF EXISTS hl_security_log_retention_30d/);
  assert.match(migration, /DROP FUNCTION IF EXISTS private\.hl_prune_platform_logs_on_insert/);
  assert.match(migration, /public\.hl_consume_geo_proxy_nonce/);
  assert.match(migration, /public\.hl_is_auth_session_active_for_security_event/);
});

test('Final verification covers Run34, Run35, Run36 and Run37 and is read-only', () => {
  for (const token of ['Run34','Run35','Run36','Run37','728194650175','hostel-life-platform-log-retention-30d','hostel-life-cron-history-retention-7d']) assert.ok(verify.includes(token));
  assert.match(verify, /SUMMARY/);
  assert.doesNotMatch(verify, /^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/im);
});

test('Cron jobs are named idempotently and scheduled for Dhaka time using the configured cron.timezone', () => {
  assert.match(migration, /hostel-life-platform-log-retention-30d/);
  assert.match(migration, /'15 21 \* \* \*'/);
  assert.match(migration, /'15 3 \* \* \*'/);
  assert.match(migration, /current_setting\('cron\.timezone'/);
  assert.match(migration, /hostel-life-cron-history-retention-7d/);
  assert.match(migration, /'45 21 \* \* \*'/);
  assert.match(migration, /'45 3 \* \* \*'/);
  assert.match(migration, /cron\.job_run_details[\s\S]*?end_time < now\(\) - interval '7 days'/);
});

test('Password reset Function prefers current named Supabase keys and preserves legacy fallback', () => {
  assert.match(reset, /SUPABASE_PUBLISHABLE_KEYS/);
  assert.match(reset, /SUPABASE_SECRET_KEYS/);
  assert.match(reset, /SUPABASE_ANON_KEY/);
  assert.match(reset, /SUPABASE_SERVICE_ROLE_KEY/);
});

test('All three admin recovery functions retain strong server-side authentication checks', () => {
  for (const source of [orphan,adminTemp,completeTemp]) {
    assert.match(source, /SUPABASE_PUBLISHABLE_KEYS/);
    assert.match(source, /SUPABASE_SECRET_KEYS/);
    assert.match(source, /auth\.getUser\(jwt\)/);
  }
  assert.match(orphan, /profile\.role !== 'super_admin'/);
  assert.match(config, /\[functions\.admin-delete-unlinked-user\]\s*verify_jwt = true/);
  assert.match(config, /\[functions\.admin-temporary-password\]\s*verify_jwt = true/);
  assert.match(config, /\[functions\.complete-temporary-password\]\s*verify_jwt = true/);
});

test('Public security gates remain pre-auth and continue to use shared signed visitor metadata', () => {
  for (const [fn,name] of [[authGate,'auth-security-gate'],[authTelemetry,'record-auth-event'],[reset,'request-password-reset']]) {
    assert.match(fn,/resolveTrustedVisitor/);
    assert.match(fn,new RegExp(`resolveTrustedVisitor\\(request, '${name}', consumeGeoNonce\\)`));
  }
  assert.match(config,/\[functions\.auth-security-gate\]\s*verify_jwt = false/);
  assert.match(config,/\[functions\.record-auth-event\]\s*verify_jwt = false/);
  assert.match(config,/\[functions\.request-password-reset\]\s*verify_jwt = false/);
});

test('Privacy policy states security telemetry and operational retention boundaries', () => {
  assert.match(privacy,/IP address/);
  assert.match(privacy,/HMAC/);
  assert.match(privacy,/৩০ দিন/);
  assert.match(privacy,/৩৫ দিন/);
  assert.match(privacy,/৪৮ ঘণ্টা/);
  assert.match(privacy,/administrative\/security audit record/);
});

test('Database and Logs diagnostics are read-only, time-bounded and distinguish Postgres from ClickHouse Logs', () => {
  assert.match(dbDiagnostic,/pg_database_size/);
  assert.match(dbDiagnostic,/extensions\.pg_stat_statements/);
  assert.match(dbDiagnostic,/pg_settings/);
  assert.match(logsSummary,/FROM logs/);
  assert.match(logsSummary,/INTERVAL 24 HOUR/);
  assert.doesNotMatch(logsSummary,/INSERT|UPDATE|DELETE|ALTER|CREATE|DROP/i);
});


test('Signed Cloudflare metadata is single-use and direct-path city/region is not persisted', () => {
  const geo = read('supabase/functions/_shared/geoProxy.ts');
  assert.match(geo, /GEO_PROXY_NONCE_CONSUMER_UNAVAILABLE/);
  assert.match(geo, /GEO_PROXY_NONCE_REPLAYED_OR_EXPIRED/);
  assert.match(geo, /consumeNonce\(nonce, timestamp\)/);
  assert.match(geo, /city: null,[\s\S]*region: null,[\s\S]*regionCode: null/);
});

test('Login-success telemetry requires a verified, active Supabase Auth session', () => {
  assert.match(authTelemetry, /AUTHENTICATED_EVENT_TYPES/);
  assert.match(authTelemetry, /admin\.auth\.getUser\(jwt\)/);
  assert.match(authTelemetry, /sessionIdFromJwtPayload/);
  assert.match(authTelemetry, /hl_is_auth_session_active_for_security_event/);
  assert.match(authTelemetry, /AUTH_SESSION_NOT_ACTIVE/);
  const publicTypes = authTelemetry.match(/const PUBLIC_EVENT_TYPES = new Set\(\[([\s\S]*?)\]\);/)?.[1] || '';
  assert.doesNotMatch(publicTypes, /login_success|password_reset_requested/);
});

test('Password-reset email validation helper is defined, type-safe, and bounded', () => {
  assert.match(reset, /function isValidEmail\(value: unknown\): value is string/);
  assert.match(reset, /email\.length >= 5 && email\.length <= 254/);
  assert.match(reset, /resolveTrustedVisitor\(request, 'request-password-reset', consumeGeoNonce\)/);
});
