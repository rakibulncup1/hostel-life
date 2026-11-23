import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyWeekdayMealExceptions, buildMealDaysForRange } from '../src/utils/weekdayMealExceptions.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

 test('final-meal editor defaults to date mode and adds member-month view through the existing final-meal writer', async () => {
  const source = await read('src/features/dining/DiningPage.jsx');
  assert.match(source, /const \[entryView, setEntryView\] = useState\('date'\)/);
  assert.match(source, /entryView === 'date'/);
  assert.match(source, /entryView === 'member'/);
  assert.match(source, /fetchMemberFinalMealMonthData\(/);
  assert.match(source, /day\?\.status === 'finalized'/);
  assert.match(source, /row\.meal_date <= todayValue\(\)/);
  assert.match(source, /await setManagerMealEntries\(payload\)/);
  assert.match(source, /fetchFinalMealAudit\(mealDate\)/);
  assert.match(source, /requestedMemberId/);
  assert.match(source, /selectedMemberRef\.current !== requestedMemberId/);
});

test('member-mode explanatory copy follows the selected view instead of remaining date-specific', async () => {
  const source = await read('src/features/dining/DiningPage.jsx');
  assert.match(source, /entryView === 'member'[\s\S]{0,180}সদস্য নির্বাচন করে চলমান মাসের প্রতিদিনের ফাইনাল মিল দেখুন/);
});

test('manual all-member requests preserve weekday exceptions and use the manager-only bulk RPC service', async () => {
  const [component, service, migration] = await Promise.all([
    read('src/features/dining/DiningPage.jsx'),
    read('src/services/diningService.js'),
    read('supabase/migrations/Run95_manager_bulk_manual_meal_requests.sql'),
  ]);
  assert.match(component, /const \[targetMode, setTargetMode\] = useState\('single'\)/);
  assert.match(component, /applyWeekdayMealExceptions/);
  assert.match(component, /createMemberMealRequests\(/);
  assert.match(component, /memberIds: activeMembers\.map\(\(member\) => member\.membership_id\)/);
  assert.match(service, /supabase\.rpc\('manager_create_member_meal_requests'/);
  assert.match(migration, /perform private\.assert_signed_in\(\)/i);
  assert.match(migration, /private\.assert_hostel_manager\(v_hostel, null, false, false\)/i);
  assert.match(migration, /private\.create_meal_request_internal\(/i);
  assert.match(migration, /archive_period_audit/); // existing validator writes the per-member audit event
  assert.match(migration, /revoke all on function public\.manager_create_member_meal_requests[\s\S]*?from public, anon/i);
  assert.match(migration, /grant execute on function public\.manager_create_member_meal_requests[\s\S]*?to authenticated/i);
  assert.match(migration, /order by requested\.member_id/i);
  assert.match(migration, /COMMIT;/);
});

test('manual weekday exceptions still apply to all matching calendar dates without mutating the source rows', () => {
  const defaults = { breakfast: 0.5, lunch: 1, dinner: 1 };
  const days = buildMealDaysForRange('2026-11-23', '2026-11-29', defaults);
  const exceptions = [{ weekday: 5, breakfast: 0, lunch: 1.5, dinner: 2 }]; // Friday
  const updated = applyWeekdayMealExceptions(days, exceptions);
  const friday = updated.find((day) => day.meal_date === '2026-11-27');
  assert.deepEqual(
    { breakfast: friday.breakfast, lunch: friday.lunch, dinner: friday.dinner },
    { breakfast: 0, lunch: 1.5, dinner: 2 },
  );
  assert.deepEqual(days.find((day) => day.meal_date === '2026-11-27'), {
    meal_date: '2026-11-27', ...defaults,
  });
});

test('About page mobile actions use a responsive grid without changing the auth entry pages', async () => {
  const [html, css] = await Promise.all([
    read('public/about.html'),
    read('public/landing-assets/run116-about-mobile-actions.css'),
  ]);
  assert.match(html, /run116-about-mobile-actions\.css/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /grid-template-columns:[^;]+/);
  assert.match(css, /@media \(max-width: 390px\)/);
  assert.match(css, /\.about-page \.wrap/);
  assert.doesNotMatch(css, /\.auth-page/);
});

test('social preview references the light branded 1200x630 image with a cache-busting version', async () => {
  const [index, about, image] = await Promise.all([
    read('index.html'), read('public/about.html'), readFile(new URL('../public/og/hostel-life-social.png', import.meta.url)),
  ]);
  assert.match(index, /og\/hostel-life-social\.png\?v=116/);
  assert.match(about, /og\/hostel-life-social\.png\?v=116/);
  assert.equal(image.toString('ascii', 1, 4), 'PNG');
  assert.equal(image.readUInt32BE(16), 1200);
  assert.equal(image.readUInt32BE(20), 630);
});

test('Google OAuth keeps consent first while nonce preparation and SDK loading start in parallel', async () => {
  const [source, styles] = await Promise.all([
    read('src/features/auth/AuthPage.jsx'), read('src/styles/google-oauth-auth-ui.css'),
  ]);
  assert.match(source, /if \(disabled \|\| !consentAccepted\)[\s\S]*?return undefined;/);
  assert.match(source, /Promise\.all\(\[[\s\S]*?prepareGoogleOAuth[\s\S]*?loadGoogleIdentityServices/);
  assert.match(styles, /\.google-signin-mark[\s\S]*?background:\s*#ffffff\s*!important/);
});

test('desktop app content expands only at large breakpoints and leaves auth layouts untouched', async () => {
  const css = await read('src/styles/ui-refresh.css');
  assert.match(css, /@media \(min-width: 1360px\)[\s\S]*?\.app-main \{ width: min\(100% - 48px, 1840px\); \}/);
  assert.match(css, /@media \(min-width: 1900px\)[\s\S]*?\.app-main \{ width: min\(100% - 72px, 2240px\); \}/);
  assert.doesNotMatch(css.slice(css.indexOf('/* Run116')), /\.auth-page/);
});

test('report logo is shifted right slightly and a low-opacity actual image watermark is printed behind report content', async () => {
  const source = await read('src/services/reportService.js');
  assert.match(source, /const logoX = Math\.round\(2\.1 \* pixelsPerMm\)/);
  assert.match(source, /const leftTextX = logoX \+ logoSize \+ Math\.round\(2\.0 \* pixelsPerMm\)/);
  assert.match(source, /context\.globalAlpha = 0\.035/);
  assert.match(source, /\.report-watermark\{position:fixed/);
  assert.match(source, /z-index:0\}\.report-body\{position:relative;z-index:1\}/);
  assert.match(source, /void Promise\.all\(\[pageHeaderReady, pageWatermarkReady\]\)/);
});
