import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const auth = read('src/features/auth/AuthPage.jsx');
const onboarding = read('src/features/onboarding/OnboardingPage.jsx');
const superAdmin = read('src/features/platform/SuperAdminPage.jsx');
const main = read('src/main.jsx');
const publicCss = read('src/styles/public-entry.css');
const adminCss = read('src/styles/platform-visual-refresh.css');

 test('public entry pages load the scoped visual stylesheet and theme switcher', () => {
  assert.match(main, /styles\/public-entry\.css/);
  assert.match(main, /styles\/platform-visual-refresh\.css/);
  assert.match(auth, /<EntryThemeSwitcher\s*\/>/);
  assert.match(onboarding, /<EntryThemeSwitcher\s*\/>/);
});

test('registration and onboarding preserve responsive presentation hooks', () => {
  assert.match(auth, /auth-register-form/);
  assert.match(auth, /register-email-note/);
  assert.match(onboarding, /onboarding-mode-picker/);
  assert.match(onboarding, /onboarding-action-panel/);
  assert.match(publicCss, /@media \(max-width: 640px\)/);
  assert.match(publicCss, /@media \(max-width: 360px\)/);
});

test('Super Admin navigation communicates the selected section accessibly', () => {
  assert.match(superAdmin, /className="platform-tabs platform-main-tabs" aria-label="পর্যবেক্ষণ বিভাগ"/);
  assert.match(superAdmin, /className="platform-tabs platform-config-tabs" aria-label="সিস্টেম সেটিংস বিভাগ"/);
  assert.match(superAdmin, /সিস্টেম সেটিংস/);
  assert.match(superAdmin, /সেশন নিরাপত্তা/);
  assert.match(superAdmin, /aria-current=\{tab===key\?'page':undefined\}/);
  assert.match(adminCss, /\.platform-page \.platform-tabs/);
});

test('Super Admin overview has a clear hierarchy and responsive metric layout', () => {
  assert.match(superAdmin, /PLATFORM SNAPSHOT/);
  assert.match(superAdmin, /এক নজরে প্ল্যাটফর্ম/);
  assert.match(superAdmin, /Privacy-aware overview/);
  assert.match(adminCss, /\.platform-overview-heading/);
  assert.match(adminCss, /grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 245px\), 1fr\)\)/);
  assert.match(adminCss, /@media \(max-width: 520px\)/);
});

test('Super Admin refinements are scoped to presentation and do not add data actions', () => {
  assert.match(adminCss, /Presentation and navigation clarity only/);
  assert.doesNotMatch(adminCss, /fetch\(|\.rpc\(|\.from\(/);
  assert.match(adminCss, /prefers-reduced-motion: reduce/);
});
