import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const about = read('public/about.html');
const runtime = read('public/language-runtime.js');
const auth = read('src/features/auth/AuthPage.jsx');
const dashboard = read('src/features/dashboard/DashboardPage.jsx');
const css = read('src/styles/run103-about-login-precision.css');
const main = read('src/main.jsx');

test('About feature heading and all four sample card captions have explicit English keys', () => {
  for (const key of [
    'about.features.eyebrow',
    'about.feature.meal.previewMeta',
    'about.feature.market.previewMeta',
    'about.feature.deposit.previewMeta',
    'about.feature.allowance.previewMeta',
  ]) {
    assert.ok(about.includes(`data-i18n-key="${key}"`), `About HTML missing ${key}`);
    assert.match(runtime, new RegExp(`['"]${key.replaceAll('.', '\\.')}['"]\\s*:`), `English map missing ${key}`);
  }
});

test('Daily activity one-place phrase is keyed and translated', () => {
  assert.match(about, /data-i18n-key="about\.preview\.organised">এক জায়গায় সাজানো/);
  assert.match(runtime, /'about\.preview\.organised':\s*'Organised in one place'/);
});

test('Sample money amounts in feature and report cards use Latin digits in English', () => {
  const keys = [
    'about.sample.market.riceAmount', 'about.sample.market.lentilsAmount',
    'about.sample.market.vegetablesAmount', 'about.sample.market.totalAmount',
    'about.sample.deposit.amount', 'about.sample.allowance.firstAmount',
    'about.sample.allowance.secondAmount', 'about.sample.allowance.thirdAmount',
    'about.sample.report.marketAmount', 'about.sample.report.balanceAmount',
    'about.sample.report.depositAmount', 'about.sample.report.expenseAmount',
  ];
  for (const key of keys) {
    assert.ok(about.includes(`data-i18n-key="${key}"`), `Missing amount key in About: ${key}`);
    assert.match(runtime, new RegExp(`['"]${key.replaceAll('.', '\\.')}['"]\\s*:\\s*'৳ [0-9,.]+'`), `Missing Latin-digit translation: ${key}`);
  }
});

test('Monthly report sample privacy note is fully translated', () => {
  assert.match(about, /data-i18n-key="about\.sample\.report\.privacyNote"/);
  assert.match(runtime, /'about\.sample\.report\.privacyNote':\s*'Sample data · No personal information'/);
});

test('Forgot-password action is placed on the login footer beside Registration, not the heading', () => {
  assert.match(auth, /<div className=\{`auth-switch \${current === 'login' \? 'auth-switch-login' : ''}`\}>/);
  assert.match(auth, /className="text-button auth-forgot-inline" onClick=\{\(\) => go\('\/auth\/forgot-password'\)\}/);
  assert.match(auth, /className="auth-switch-prompt"[\s\S]*?link\.label[\s\S]*?auth-forgot-inline/);
  assert.doesNotMatch(auth, /headerAction=/);
  assert.match(auth, /title="অ্যাকাউন্টে প্রবেশ করুন"/);
  assert.match(auth, /আবারও স্বাগতম/);
  assert.match(auth, /data-i18n-key=\{title === 'অ্যাকাউন্টে প্রবেশ করুন' \? 'auth\.login\.heading'/);
  assert.match(runtime, /'auth\.login\.heading':\s*'Account Login'/);
});

test('Login footer actions remain side-by-side responsively and About branding is preserved', () => {
  assert.match(css, /\.auth-switch-login\s*\{[\s\S]*display:\s*flex[\s\S]*justify-content:\s*space-between/);
  assert.match(css, /\.auth-switch-prompt\s*\{[\s\S]*display:\s*inline-flex/);
  assert.match(css, /@media \(max-width:\s*640px\)[\s\S]*auth-shell-login/);
  assert.match(css, /white-space:\s*nowrap/);
});

test('Google outline button fill is subtly deepened without replacing Google branding', () => {
  assert.match(css, /background:\s*#f4f6f8/);
  assert.match(css, /border-color:\s*#d6d9dd/);
  assert.match(css, /background:\s*#f1f3f4/);
  assert.doesNotMatch(css, /google-signin-mark|google-signin-sdk-slot|iframe/);
});

test('Run103 stylesheet is imported once at the end of app styles', () => {
  assert.equal((main.match(/run103-about-login-precision\.css/g) || []).length, 1);
});


test('Member detail modal uses a centered wide frame and six compact cards across two desktop rows', () => {
  assert.match(css, /member-period-detail-modal\s*\{[\s\S]*width:\s*min\(920px,\s*calc\(100vw - 36px\)\) !important/);
  assert.match(css, /member-period-summary-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\) !important/);
  assert.match(css, /grid-auto-rows:\s*minmax\(84px,\s*auto\) !important/);
  assert.match(css, /@media \(max-width:\s*640px\)[\s\S]*member-period-summary-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\) !important/);
  assert.match(dashboard, /member-period-detail-modal/);
});
