import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const history = read('src/features/history/HistoryPage.jsx');
const archive = read('src/features/archive/ArchiveCorrectionPage.jsx');
const report = read('src/services/reportService.js');
const auth = read('src/features/auth/AuthPage.jsx');
const app = read('src/app/App.jsx');
const shell = read('src/app/AppShell.jsx');
const css = read('src/styles/ui-polish-v45.css');
const migration = read('supabase/migrations/Run41_member_history_and_archive_report.sql');
const template = read('supabase/templates/signup-confirmation-10min.html');
const config = read('supabase/config.toml');
const otpGuide = read('supabase/OTP_10_MINUTE_SETUP_BN.md');
const manager = read('src/features/manager/ManagerPages.jsx');
const dining = read('src/features/dining/DiningPage.jsx');
const main = read('src/main.jsx');
const dashboard = read('src/features/dashboard/DashboardPage.jsx');

test('Run45 same-hostel account history RPC exposes read access without relaxing table RLS', () => {
  assert.match(migration, /create or replace function public\.get_account_history_v2/);
  assert.match(migration, /perform private\.assert_signed_in\(\)/);
  assert.match(migration, /v_hostel uuid := private\.my_hostel_id\(\)/);
  assert.match(migration, /hostel_id=v_hostel/);
  assert.match(migration, /monthly_periods where id=v_period and hostel_id=v_hostel/);
  assert.match(migration, /v_effective_member is null or member_id=v_effective_member/);
  assert.doesNotMatch(migration, /ledger_type='other_expense' and member_id is null/);
  assert.doesNotMatch(migration, /শুধু নিজের লেনদেনের হিসাব দেখার অনুমতি আছে/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_account_history_v2\(uuid,uuid,integer\) TO authenticated/);
  assert.doesNotMatch(migration, /create\s+policy|alter\s+table[\s\S]{0,80}row level security/i);
});

test('Run45 archived report RPC returns same-hostel member settlements and separate khala entries', () => {
  assert.match(migration, /where hm\.hostel_id=v_hostel/);
  assert.match(migration, /hm\.created_at < \(\(v_period\.end_date \+ 1\)::timestamp at time zone 'Asia\/Dhaka'\)/);
  assert.match(migration, /private\.member_financials\(v_period\.id,hm\.id\)/);
  assert.match(migration, /where k\.hostel_id=v_hostel and k\.period_id=v_period\.id/);
  assert.match(migration, /'members',v_members,'khala_entries',v_khala/);
  assert.match(migration, /status in \('closed','archived'\)/);
});

test('all members can filter same-hostel account history while edits still depend on manager permission', () => {
  assert.match(history, /const memberId = accountFilter \|\| null/);
  assert.match(history, /এই মেসের সকল সদস্যের জমা-খরচ দেখা যাবে/);
  assert.match(history, /canEdit=\{Boolean\(canEditVisibleRows\)\}/);
  assert.match(history, /canEditVisibleRows = Boolean/);
});

test('archived PDF reuses the five-section complete monthly report and waits for migration data', () => {
  assert.match(report, /export function printArchivedMonthlyReport/);
  for (const title of ['১. সদস্যভিত্তিক ফাইনাল হিসাব','২. বাজার হিসাব','৩. ডিপোজিট হিসাব','৪. খালার পারিশ্রমিক — পৃথক হিসাব','৫. দৈনিক মিলের সারসংক্ষেপ']) {
    assert.ok(report.includes(title), `missing section ${title}`);
  }
  assert.match(archive, /পূর্ণ রিপোর্ট PDF/);
  assert.match(history, /disabled=\{!Array\.isArray\(detail\.members\)\}/);
  assert.match(history, /const detail = await fetchArchivedMonthDetail\(row\.period_id\)/);
});

test('market history detail shares through the same shared market-text builder', () => {
  assert.match(history, /buildMarketShareText/);
  assert.match(history, /শর্ট শেয়ার/);
  assert.match(history, /navigator\.share/);
  assert.match(history, /navigator\.clipboard\.writeText\(shareText\)/);
});

test('dashboard member card detail and upcoming daily member detail reuse existing RPCs', () => {
  assert.match(dashboard, /fetchMemberPeriodDetails/);
  assert.match(dashboard, /onSelectDay=\{setSelectedUpcomingDate\}/);
  assert.match(dashboard, /fetchMealDetails\(selectedUpcomingDate, \{ force: true \}\)/);
  assert.match(dashboard, /upcoming-meal-day-card/);
});

test('meal sheet date headers use localized short month names', () => {
  assert.match(manager, /function formatMealSheetColumnDate/);
  assert.match(manager, /month:\s*'short'/);
  assert.match(manager, /formatMealSheetColumnDate\(day\.meal_date\)/);
});

test('signup OTP uses spam guidance, 10-minute hosted setup and unverified-email retry flow', () => {
  assert.match(auth, /Spam\/Junk/);
  assert.match(auth, /identities\.length === 0/);
  assert.match(auth, /resendSignUpOtp\(email\)/);
  assert.match(auth, /Always route to verification/);
  assert.match(auth, /if \(resendError\) \{/);
  assert.match(template, /\{\{ \.Token \}\}/);
  assert.match(template, /১০ মিনিট/);
  assert.match(template, /Spam বা Junk ফোল্ডার/);
  assert.match(config, /otp_expiry = 600/);
  assert.match(otpGuide, /Email OTP expiration/);
  assert.match(otpGuide, /REGISTER_OTP_FLOW_MAX_AGE/);
});

test('app resume saves only a safe app route and scroll position, never sensitive form state', () => {
  assert.match(app, /hostel-life-app-resume-v1/);
  assert.match(app, /saved\.path\.startsWith\('\/app\/'\)/);
  assert.match(app, /scrollY/);
  assert.match(app, /getSafeResumeSearch/);
  assert.match(app, /history_tab/);
  assert.match(history, /updateHistoryTab/);
  const resumeEffect = app.slice(app.indexOf('Preserve the last app location'), app.indexOf('useEffect(() => {\n    // The install guide'));
  assert.match(resumeEffect, /auth\.identityReady/);
  assert.match(resumeEffect, /pathname !== '\/app\/dashboard'/);
  assert.match(resumeEffect, /JSON\.stringify\(\{ path: pathname, search: getSafeResumeSearch\(pathname\), scrollY: Math\.max\(0, window\.scrollY \|\| 0\), savedAt: Date\.now\(\) \}\)/);
  assert.doesNotMatch(resumeEffect, /JSON\.stringify\(\{[^}]*password|JSON\.stringify\(\{[^}]*otp|JSON\.stringify\(\{[^}]*draft/i);
});

test('Run45 light theme is green-tinted but token based; Telegram nudge is compact', () => {
  assert.match(css, /:root\[data-theme="light"\]/);
  assert.match(css, /--primary:\s*#19845b/);
  assert.match(css, /telegram-nudge-dialog/);
  assert.match(css, /width: min\(100%, 360px\)/);
  assert.match(shell, /মেসের নোটিশ টেলিগ্রামে পান/);
  assert.match(dining, /manager-request-review-guide/);
  assert.match(dining, /market-paste-hint-boxed/);
  assert.match(manager, /month-close-primary-guidance/);
  assert.match(history, /history-intro-guidance-box/);
  assert.match(main, /styles\/ui-polish-v45\.css/);
});
