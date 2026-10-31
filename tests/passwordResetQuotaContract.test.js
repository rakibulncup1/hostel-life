import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/Run18_password_reset_quota.sql', import.meta.url), 'utf8');
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

test('quota migration applies 1/day and 3/month using Dhaka calendar boundaries', () => {
  assert.match(migration, /Asia\/Dhaka/);
  assert.match(migration, /v_monthly_used >= 3/);
  assert.match(migration, /v_daily_used >= 1/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /pg_try_advisory_xact_lock/);
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
});

test('forgot-password form explains daily and monthly limits and manual recovery', () => {
  assert.match(page, /দিনে সর্বোচ্চ ১ বার/);
  assert.match(page, /প্রতি ক্যালেন্ডার মাসে সর্বোচ্চ ৩ বার/);
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

