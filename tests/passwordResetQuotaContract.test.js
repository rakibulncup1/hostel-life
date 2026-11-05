import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/Run18_password_reset_quota.sql', import.meta.url), 'utf8');
const upgradedMigration = readFileSync(new URL('../supabase/migrations/Run35_super_admin_security_retention_telegram_sessions.sql', import.meta.url), 'utf8');
const edge = readFileSync(new URL('../supabase/functions/request-password-reset/index.ts', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/services/authService.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/features/auth/AuthPage.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles/ui-refresh.css', import.meta.url), 'utf8');

test('quota migration is additive and stores only HMAC fingerprints with timestamps', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS private\.password_reset_request_log/);
  assert.match(migration, /email_fingerprint text NOT NULL/);
  assert.match(migration, /requested_at timestamptz NOT NULL/);
  assert.doesNotMatch(migration, /email\s+text\s+NOT NULL/i);
  assert.doesNotMatch(migration, /password\s+text/i);
  assert.match(migration, /35 days/);
});

test('historical Run18 1/day and 3/month is superseded by Run35 2/day and 5/month', () => {
  assert.match(migration, /Asia\/Dhaka/);
  assert.match(migration, /v_monthly_used >= 3/);
  assert.match(migration, /v_daily_used >= 1/);
  assert.match(upgradedMigration, /v_monthly_used>=5/);
  assert.match(upgradedMigration, /v_daily_used>=2/);
  assert.match(upgradedMigration, /'daily_limit',2,'monthly_limit',5/);
  assert.match(upgradedMigration, /Asia\/Dhaka/);
  assert.match(upgradedMigration, /pg_advisory_xact_lock/);
});

test('quota RPCs are callable by service_role only, not browser roles', () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.consume_password_reset_quota\(text\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.consume_password_reset_quota\(text\) TO service_role/);
  assert.match(migration, /ALTER TABLE private\.password_reset_request_log ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE private\.password_reset_request_log FROM PUBLIC, anon, authenticated, service_role/);
});

test('frontend sends recovery requests through the quota Edge Function, not Auth directly', () => {
  assert.match(service, /functions\.invoke\('request-password-reset'/);
  assert.doesNotMatch(service, /auth\.resetPasswordForEmail/);
  assert.match(edge, /authClient\.auth\.resetPasswordForEmail/);
  assert.match(edge, /hl_consume_password_reset_ip_request/);
  assert.match(edge, /PASSWORD_RESET_IP_TEMPORARILY_BLOCKED/);
  assert.match(upgradedMigration, /more_than_2_password_reset_requests_per_hour/);
  assert.match(upgradedMigration, /v_now\+interval '1 hour'/);
});

test('forgot-password form explains daily and monthly limits and manual recovery', () => {
  assert.match(page, /দিনে সর্বোচ্চ ২ বার/);
  assert.match(page, /প্রতি ক্যালেন্ডার মাসে সর্বোচ্চ ৫ বার/);
  assert.match(page, /Help Section/);
  assert.match(page, /Temporary Password/);
  assert.match(page, /PASSWORD_RESET_DAILY_LIMIT/);
  assert.match(page, /PASSWORD_RESET_MONTHLY_LIMIT/);
  assert.match(css, /\.password-reset-policy/);
});

test('Edge Function uses a server-only HMAC key, validates origin and never logs the email', () => {
  assert.match(edge, /PASSWORD_RESET_HMAC_SECRET/);
  assert.match(edge, /crypto\.subtle\.importKey/);
  assert.match(edge, /PASSWORD_RESET_ALLOWED_ORIGINS/);
  assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(edge, /console\.(log|error).*email/i);
});

