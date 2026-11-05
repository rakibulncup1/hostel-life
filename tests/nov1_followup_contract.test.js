import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDhakaBusinessDate, getPeriodAwareError, getPeriodStartNotice } from '../src/utils/periodMessaging.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

const dining = read('src/features/dining/DiningPage.jsx');
const onboarding = read('src/features/onboarding/OnboardingPage.jsx');
const history = read('src/features/history/HistoryPage.jsx');
const reportService = read('src/services/reportService.js');
const manager = read('src/features/manager/ManagerPages.jsx');
const ranking = read('src/services/rankingService.js');
const menu = read('src/features/menu/MenuPages.jsx');
const drawer = read('src/components/MenuDrawer.jsx');
const app = read('src/app/App.jsx');
const auth = read('src/features/auth/AuthPage.jsx');
const styles = read('src/styles/ui-refresh.css');
const publicStyles = read('src/styles/public-entry.css');


test('future-start period notice uses Dhaka business dates and an explicit start date', () => {
  assert.equal(getDhakaBusinessDate(new Date('2026-10-31T18:00:00.000Z')), '2026-11-01');
  const period = { start_date: '2026-11-01' };
  const notice = getPeriodStartNotice(period, 'বাজার এন্ট্রি', '2026-10-31');
  assert.match(notice, /নতুন মাস/);
  assert.match(notice, /বাজার এন্ট্রি/);
  assert.match(notice, /১ নভেম্বর, ২০২৬/);
  assert.equal(getPeriodStartNotice(period, 'বাজার এন্ট্রি', '2026-11-01'), '');
});

test('only period-boundary errors are rewritten with the next start date', () => {
  const period = { start_date: '2026-11-01' };
  const message = getPeriodAwareError(
    { message: 'বাজারের তারিখটি চলমান মাসের মধ্যে হতে হবে।' },
    'বাজার সংরক্ষণ করা যায়নি।',
    period,
    'বাজার এন্ট্রি',
    '2026-10-31',
  );
  assert.match(message, /১ নভেম্বর, ২০২৬/);
  const permission = getPeriodAwareError({ message: 'এই কাজের অনুমতি নেই।' }, 'বাজার সংরক্ষণ করা যায়নি।', period, 'বাজার এন্ট্রি', '2026-10-31');
  assert.equal(permission, 'এই কাজের অনুমতি নেই।');
});

test('market-entry inputs expose a stable focus path and keyboard Next navigation', () => {
  assert.match(dining, /marketInputRefs = useRef\(new Map\(\)\)/);
  assert.match(dining, /enterKeyHint="next"/);
  assert.match(dining, /moveToNextMarketField/);
  assert.doesNotMatch(dining, /document\.activeElement === document\.body|target\.focus\(\{ preventScroll: true \}\)/);
  assert.match(dining, /const updateItem = \(index, patch\) =>/);
  assert.match(dining, /pendingMarketFocusIndexRef/);
});

test('market, deposit, other-expense and Khala forms explain a future period start', () => {
  assert.match(dining, /getPeriodStartNotice\(period, 'বাজার এন্ট্রি'\)/);
  assert.match(dining, /getPeriodStartNotice\(period, 'ডিপোজিট'\)/);
  assert.match(dining, /getPeriodStartNotice\(period, 'অন্যান্য খরচ'\)/);
  assert.match(dining, /ম্যানেজারের সরাসরি ফাইনাল মিল এন্ট্রি/);
  assert.match(manager, /getPeriodStartNotice\(selectedPeriod, 'খালার টাকার এন্ট্রি'\)/);
  assert.match(manager, /ম্যানেজার পরিবর্তন একটি আলাদা অনুমতি-নিয়ন্ত্রিত কাজ/);
});

test('onboarding has its own centered app brand, distinct from the login screen', () => {
  assert.match(onboarding, /<BrandMark size=\{62\}/);
  assert.match(onboarding, /onboarding-brand-header/);
  assert.match(onboarding, /onboarding-choice-intro/);
  assert.match(styles, /\.onboarding-brand-header[\s\S]*?align-items: center/);
  assert.match(onboarding, /onboarding-mode-picker/);
  assert.match(publicStyles, /@media \(max-width: 640px\)[\s\S]*?\.onboarding-mode-picker/);
});

test('current history queries are explicitly scoped to the running period', () => {
  assert.match(history, /selectedArchivePeriodId \|\| runningMonth\?\.period_id \|\| runningMonth\?\.id \|\| null/);
});

test('downloadable meal reports use finalized day rows only and never read planned meal values', () => {
  const fetchStart = reportService.indexOf('export async function fetchRunningPeriodReport');
  const fetchEnd = reportService.indexOf('export async function fetchCurrentReportBundle', fetchStart);
  const functionBody = reportService.slice(fetchStart, fetchEnd);
  assert.match(functionBody, /day\.status !== 'finalized'/);
  assert.match(functionBody, /record\.final_breakfast, record\.actual_breakfast/);
  assert.doesNotMatch(functionBody, /record\.planned_(?:breakfast|lunch|dinner)/);
  assert.match(manager, /buildDailyMealRows\(bundle\.days, bundle\.mealRows\)\.filter\(\(row\) => row\.status === 'finalized'\)/);
  assert.match(manager, /const finalizedDays = bundle\.days\.filter\(\(day\) => day\.status === 'finalized'\)/);
});

test('top depositors reuse the existing member-directory deposit balance without a new SQL RPC', () => {
  assert.match(ranking, /fetchMemberDirectory\(\{ force: true \}\)/);
  assert.match(ranking, /total_deposit: Number\(member\.deposit \|\| 0\)/);
  assert.match(menu, /fetchTopDepositors/);
  assert.match(menu, /TopDepositorsPage/);
  assert.match(drawer, /top-depositor/);
  assert.match(app, /menu\/top-depositor/);
});

test('login/register and onboarding public surfaces apply the saved theme preference before paint', () => {
  assert.match(auth, /useLayoutEffect\([\s\S]*?applyTheme\(getThemePreference\(\)\)/);
  assert.match(onboarding, /useLayoutEffect\([\s\S]*?applyTheme\(getThemePreference\(\)\)/);
  assert.match(auth, /EntryThemeSwitcher/);
  assert.match(onboarding, /EntryThemeSwitcher/);
});
