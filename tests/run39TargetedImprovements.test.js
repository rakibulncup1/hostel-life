import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/Run39_targeted_hostel_life_improvements.sql');
const verify = read('../supabase/verify/Verify_Run39_targeted_improvements.sql');
const auth = read('../src/services/authService.js');
const authPage = read('../src/features/auth/AuthPage.jsx');
const worker = read('../cloudflare/hostel-life-security-proxy/src/index.js');
const authEventEdge = read('../supabase/functions/record-auth-event/index.ts');
const telegram = read('../supabase/functions/telegram-notification-dispatch/index.ts');
const superAdmin = read('../src/features/platform/SuperAdminPage.jsx');
const notifications = read('../src/components/NotificationsPopover.jsx');

test('Run39 is additive, guarded, transaction-wrapped, and has a matching read-only verification script', () => {
  assert.match(migration, /(?:^|\n)BEGIN;/);
  assert.match(migration, /SET LOCAL lock_timeout/);
  assert.match(migration, /\$run39_preflight\$/);
  assert.match(migration, /COMMIT;/);
  assert.match(verify, /Read-only post-deployment verification/);
  assert.match(verify, /hlc_apply_archive_correction/);
});

test('Security Monitor captures attempted email without ever accepting password or OTP fields', () => {
  assert.match(migration, /attempt_email text/);
  assert.match(migration, /platform_admin_list_security_events_v4/);
  assert.match(migration, /matched_profile_name/);
  assert.match(auth, /recordAuthTelemetry\('signup_failed', normalizedEmail/);
  assert.match(superAdmin, /চেষ্টা করা ইমেইল/);
  assert.match(auth, /body:\s*\{\s*event_type: eventType, email: typeof email === 'string'[^}]*failure_code: failureCode/s);
  assert.doesNotMatch(auth, /body:\s*\{[^}]*\b(?:password|otp|verification_code)\s*:/is);
});

test('Cloudflare Worker forwards only signed request.cf city and region metadata', () => {
  assert.match(worker, /const city = encodeLocation\(cf\.city/);
  assert.match(worker, /const region = encodeLocation\(cf\.region/);
  assert.match(worker, /const regionCode = encodeLocation\(cf\.regionCode/);
  assert.match(worker, /canonicalPayload\(signed\)/);
  assert.match(authEventEdge, /hl_consume_geo_proxy_nonce/);
});

test('Creator and editor identities are exposed for finance history and Khala entries', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION private\.hl_capture_financial_editor/);
  assert.match(migration, /ALTER TABLE public\.khala_money_entries ADD COLUMN IF NOT EXISTS updated_by/);
  assert.match(migration, /'created_by_name'/);
  assert.match(migration, /'updated_by_name'/);
});

test('Market, deposit, Khala, and period notifications include actor and target details', () => {
  assert.match(migration, /নতুন বাজার · /);
  assert.match(migration, /নতুন জমা · /);
  assert.match(migration, /খালার পারিশ্রমিক · /);
  assert.match(migration, /FROM public\.hostel_memberships m JOIN public\.profiles p ON p\.id=m\.user_id\s+WHERE m\.hostel_id=NEW\.hostel_id AND m\.status='active'/);
  assert.match(telegram, /🏠 Hostel Life/);
  assert.match(telegram, /line\.replace\(/);
  assert.match(notifications, /archive_correction|Hostel Life আপডেট/);
});

test('Registration UI uses six-digit native Supabase OTP with cooldown and server-backed verification', () => {
  assert.match(authPage, /ভেরিফিকেশন কোড পাঠান/);
  assert.match(authPage, /resendCountdown/);
  assert.match(authPage, /setResendCountdown\(60\)/);
  assert.match(auth, /verifyOtp\(\{ email: normalizedEmail, token: code, type: 'signup' \}\)/);
  assert.match(auth, /resend\(\{ type: 'signup', email: normalizedEmail \}\)/);
});

test('Former month closer receives only their own exact closed period, and existing archive correction stays bounded', () => {
  assert.match(migration, /mp\.status IN \('closed','archived'\) AND mp\.closed_by=auth\.uid\(\)/);
  assert.match(migration, /m\.status='active' AND NOT COALESCE\(p\.is_blocked,false\)/);
  assert.match(migration, /private\.can_manage_closed_period\(v_h,p_period_id\)/);
  assert.match(migration, /hlc_apply_archive_correction/);
  assert.match(migration, /khala_entry_end_date/);
  assert.match(migration, /p_payment_date>COALESCE\(v_period\.khala_entry_end_date,v_period\.end_date\)/);
  assert.match(migration, /member_id,member_name_snapshot,payment_date/);
});

test('Meal-request notification uses the real meal_requests.review_reason column, not hostel_join_requests.review_note', () => {
  assert.match(migration, /\('public','meal_requests','review_reason'\)/);
  assert.doesNotMatch(migration, /\('public','meal_requests','review_note'\)/);
  assert.match(migration, /NEW\.review_reason/);
  assert.doesNotMatch(migration, /NEW\.review_note/);
});

test('Former-closer privilege is not added to the generic manager helper', () => {
  const helperStart = migration.indexOf('CREATE OR REPLACE FUNCTION private.can_manage_hostel(');
  const helperEnd = migration.indexOf('$function$;', helperStart);
  assert.notEqual(helperStart, -1);
  assert.notEqual(helperEnd, -1);
  const helperBody = migration.slice(helperStart, helperEnd);
  assert.doesNotMatch(helperBody, /can_manage_closed_period/);
  assert.match(migration, /private\.can_manage_closed_period\(v_entry\.hostel_id,v_entry\.period_id\)/);
  assert.match(migration, /private\.can_manage_closed_period\(v_h,p_period_id\)/);
});
