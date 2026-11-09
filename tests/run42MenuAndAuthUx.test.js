import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const auth = read('src/features/auth/AuthPage.jsx');
const menu = read('src/components/MenuDrawer.jsx');
const menuPages = read('src/features/menu/MenuPages.jsx');
const managerPages = read('src/features/manager/ManagerPages.jsx');
const dining = read('src/features/dining/DiningPage.jsx');
const appDownload = read('src/features/menu/AppDownloadPage.jsx');
const css = read('src/styles/ui-polish-v42.css');
const main = read('src/main.jsx');

test('Run42 keeps the mobile auth header to a small brand mark with no instructional copy', () => {
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /auth-brand-highlight/);
  assert.match(css, /auth-brand-panel h1/);
  assert.match(css, /auth-brand-panel p/);
  assert.match(css, /width: 37px; height: 37px/);
});

test('registration OTP state survives same-tab reload/return without storing passwords', () => {
  assert.match(auth, /REGISTER_OTP_FLOW_KEY/);
  assert.match(auth, /window\.sessionStorage\.getItem/);
  assert.match(auth, /window\.sessionStorage\.setItem/);
  assert.match(auth, /resendUntil/);
  assert.match(auth, /pageshow/);
  assert.match(auth, /visibilitychange/);
  assert.match(auth, /sessionStorage\.setItem\(REGISTER_OTP_FLOW_KEY, JSON\.stringify\(\{ \.\.\.value, savedAt: Date\.now\(\) \}\)\)/);
  assert.doesNotMatch(auth.match(/function saveRegisterOtpFlow\(value\) \{[\s\S]*?\n\}/)?.[0] || '', /password|confirmPassword/i);
});

test('verification displays email, one OTP input, mail folder tip, live countdown and return action', () => {
  const start = auth.indexOf('{otpStep ? (');
  const end = auth.indexOf(') : (', start);
  const otpBranch = auth.slice(start, end);
  assert.match(otpBranch, /auth-verification-email/);
  assert.match(otpBranch, /\{email\}/);
  assert.equal((otpBranch.match(/className="auth-otp-input"/g) || []).length, 1);
  assert.match(otpBranch, /auth-verification-mail-tip/);
  assert.match(otpBranch, /Spam বা Promotions/);
  assert.match(otpBranch, /auth-otp-countdown/);
  assert.match(otpBranch, /রেজিস্ট্রেশনে ফিরে যান/);
});

test('all menu groups remain present through logout', () => {
  for (const label of ['মিল শিট', 'আর্কাইভ', 'রিপোর্ট ডাউনলোড', 'সকল সদস্য', 'শীর্ষ খাদক', 'বেশি বাজারকারী', 'বেশি ডিপোজিটকারী', 'সিস্টেম তথ্য', 'ম্যানেজার ফিচার', 'লগআউট']) {
    assert.ok(menu.includes(label), `missing menu item: ${label}`);
  }
});

test('menu and operational feature guidance is concise and uses shared compact styling', () => {
  assert.match(menuPages, /description=\{depositor \? 'সদস্যের নামে জমা হওয়া মোট টাকা।' : shopper \? 'কার্যকর বাজারের মোট টাকার তালিকা।'/);
  assert.match(managerPages, /description="মাসিক হিসাব PDF হিসেবে সংরক্ষণ করুন।"/);
  assert.match(dining, /তারিখ ও মিল বেছে অনুরোধ দিন। Late\/Correction-এ অনুমোদন লাগবে।/);
  assert.match(css, /\.info-panel \{/);
  assert.match(css, /\.form-hint,/);
});

test('app download instructions are short and theme-native styles are token-based', () => {
  assert.match(appDownload, /হোম স্ক্রিন থেকে এক ট্যাপে Hostel Life খুলুন।/);
  assert.match(css, /var\(--surface-2\)/);
  assert.match(css, /var\(--primary-soft\)/);
});

test('Run42 stylesheet is loaded after the existing UI refresh', () => {
  assert.match(main, /styles\/ui-polish-v42\.css/);
  assert.ok(main.indexOf('styles/ui-polish-v41.css') < main.indexOf('styles/ui-polish-v42.css'));
});
