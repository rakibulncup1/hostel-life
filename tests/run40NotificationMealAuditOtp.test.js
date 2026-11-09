import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/Run40_notification_meal_audit_and_signup_otp_guard.sql');
const authPage = read('../src/features/auth/AuthPage.jsx');
const otpFunction = read('../supabase/functions/request-signup-otp/index.ts');
const diningPage = read('../src/features/dining/DiningPage.jsx');
const toast = read('../src/components/Toast.jsx');
const toastCss = read('../src/styles/production-flow-finishing.css');

test('Run40 market notification waits for the calculated total and prevents a second zero-value insert alert', () => {
  assert.match(migration, /DROP TRIGGER IF EXISTS hl_market_notification_ins/);
  assert.match(migration, /AFTER UPDATE OF total_amount ON public\.market_entries/);
  assert.match(migration, /OLD\.total_amount IS NOT DISTINCT FROM 0 AND NEW\.total_amount > 0/);
  assert.match(migration, /NEW\.total_amount,'FM999,999,999,990\.00'/);
});

test('Run40 deposit notification names the recipient, amount and the person who entered it', () => {
  assert.match(migration, /v_body:=v_member\|\|'-এর নামে ৳'\|\|v_amount/);
  assert.match(migration, /জমা যুক্ত হয়েছে। এন্ট্রি করেছেন/);
  assert.match(migration, /FROM public\.hostel_memberships m JOIN public\.profiles p ON p\.id=m\.user_id/);
});

test('Final-meal audit is read-only and reuses canonical meal and archive records', () => {
  assert.match(migration, /FUNCTION public\.hl_get_final_meal_audit\(p_meal_date date\)/);
  assert.match(migration, /LANGUAGE plpgsql STABLE SECURITY DEFINER/);
  assert.match(migration, /FROM public\.daily_meal_records r/);
  assert.match(migration, /FROM public\.archive_period_audit a/);
  assert.match(migration, /'pending_members'/);
  assert.doesNotMatch(migration, /CREATE TABLE[^;]*(?:meal_audit|final_meal_audit)/i);
});

test('Final-meal audit distinguishes request-derived cutoff finalization from manual manager edits', () => {
  assert.match(migration, /r\.finalization_source IN \('manager_edit','archive_correction','emergency_override'\) THEN 'manual'/);
  assert.match(migration, /r\.finalization_source='auto_cutoff' AND req\.id IS NOT NULL THEN 'অনুরোধ অনুমোদিত/);
  assert.match(migration, /req\.reviewed_by/);
  assert.match(migration, /req\.reviewed_at/);
  assert.match(migration, /'actor_name',actor_name/);
  assert.match(migration, /'finalized_at',event_at/);
});

test('Final-meal audit UI displays totals, member provenance, timestamps and pending members', () => {
  assert.match(diningPage, /fetchFinalMealAudit\(date\)/);
  assert.match(diningPage, /ম্যানুয়াল এন্ট্রি\/সংশোধন/);
  assert.match(diningPage, /অনুরোধ থেকে ফাইনাল/);
  assert.match(diningPage, /এখনো ফাইনাল হয়নি/);
  assert.match(diningPage, /record\.actor_name/);
  assert.match(diningPage, /record\.finalized_at/);
});

test('Signup OTP resend uses the existing security log with a 2-per-email daily and 2-per-IP hourly quota', () => {
  assert.match(migration, /hl_consume_signup_otp_resend/);
  assert.match(migration, /v_email_count>=2/);
  assert.match(migration, /v_ip_count>=2/);
  assert.match(migration, /INSERT INTO private\.hl_security_events/);
  assert.doesNotMatch(migration, /CREATE TABLE[^;]*signup_otp/i);
  assert.match(otpFunction, /auth\.resend\(\{ type: 'signup', email \}\)/);
  assert.match(otpFunction, /hl_consume_signup_otp_resend/);
  assert.match(otpFunction, /নেটওয়ার্ক থেকে এক ঘণ্টায় সর্বোচ্চ ২টি/);
  assert.match(otpFunction, /ইমেইলে প্রতিদিন সর্বোচ্চ ২ বার/);
  assert.doesNotMatch(otpFunction, /console\.(?:log|warn|error)[^;]*(?:body\.(?:otp|token|password)|verificationCode|suppliedPassword)/i);
});

test('Registration OTP uses a six-digit input and a longer 120-second resend cooldown', () => {
  assert.match(authPage, /setResendCountdown\(120\)/);
  assert.match(authPage, /function formatOtpWait\(seconds\)/);
  assert.match(authPage, /formatOtpWait\(resendCountdown\)/);
  assert.match(authPage, /pattern="\[0-9\]\{6\}"/);
  assert.match(authPage, /maxLength=\{6\}/);
  assert.match(authPage, /resendSignUpOtp\(email\)/);
});

test('Toast messages are top-positioned, auto-dismissed and use only red/green status variants', () => {
  assert.match(toast, /window\.setTimeout/);
  assert.match(toast, /toast-error/);
  assert.match(toast, /toast-success/);
  assert.doesNotMatch(toast, /onClick=\{\(\) => remove/);
  assert.match(toastCss, /\.toast-stack\s*\{[^}]*top:/s);
});

test('Auth and join pages keep the selected theme; OTP and mobile header use theme tokens', () => {
  const publicEntryCss = read('../src/styles/public-entry.css');
  const onboardingPage = read('../src/features/onboarding/OnboardingPage.jsx');
  assert.match(publicEntryCss, /:root\[data-theme="dark"\] \.auth-page/);
  assert.match(publicEntryCss, /:root\[data-theme="blue"\] \.auth-page/);
  assert.doesNotMatch(toastCss, /\.auth-page\s*,\s*\n\.onboarding-page\s*\{[^}]*color-scheme:\s*light/s);
  assert.doesNotMatch(toastCss, /--surface:\s*#ffffff/);
  assert.doesNotMatch(toastCss, /color-scheme:\s*light\s*!important/);
  assert.match(toastCss, /\.auth-otp-card\s*\{[^}]*var\(--surface\)/s);
  assert.match(toastCss, /\.auth-otp-input\s*\{[^}]*var\(--text\)/s);
  assert.match(toastCss, /border-bottom:\s*1px solid var\(--line\)/);
  const onboardingCss = read('../src/styles/ui-refresh.css');
  assert.doesNotMatch(onboardingCss, /\.onboarding-choice-intro \{[^}]*background:\s*rgba\(23,\s*51,\s*35/s);
  assert.doesNotMatch(onboardingCss, /\.onboarding-choice-intro \{[^}]*border:\s*1px solid rgba\(112,\s*186,\s*145/s);
  assert.doesNotMatch(onboardingPage, /<p>\{mode === 'join' \? 'মেসের ১২ অক্ষরের কোড দিন।'/);
});
