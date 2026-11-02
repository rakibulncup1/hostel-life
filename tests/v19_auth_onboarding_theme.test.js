import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const auth = read('src/features/auth/AuthPage.jsx');
const onboarding = read('src/features/onboarding/OnboardingPage.jsx');
const profile = read('src/features/profile/ProfilePage.jsx');
const shell = read('src/app/AppShell.jsx');
const css = read('src/styles/ui-refresh.css');

test('mobile auth title card centers every title and supporting line', () => {
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.auth-page \.auth-form-panel \.auth-header[\s\S]*?text-align: center !important/);
  assert.match(css, /\.auth-page \.auth-form-panel \.auth-header h2[\s\S]*?text-align: center/);
  assert.match(css, /\.auth-page \.auth-form-panel \.auth-header p[\s\S]*?text-align: center/);
  assert.match(auth, /আবারও স্বাগতম/);
  assert.match(auth, /নতুন যাত্রা শুরু হোক/);
  assert.match(css, /background: linear-gradient\(145deg, rgba\(28, 54, 40/);
});

test('registration email guidance is shown in a compact info panel', () => {
  assert.match(auth, /className="register-email-hint"/);
  assert.match(auth, /<Icon name="info" size=\{14\}/);
  assert.match(css, /\.auth-page \.auth-form-panel \.register-email-hint[\s\S]*?border-left: 3px solid/);
});

test('onboarding has only a concise return action and its heading copy is informational', () => {
  assert.match(onboarding, /ভুল অ্যাকাউন্টে এসেছেন বা অন্য অ্যাকাউন্ট ব্যবহার করবেন/);
  assert.match(onboarding, /লগইন \/ রেজিস্ট্রেশন পেজে ফিরুন/);
  assert.match(onboarding, /<p className="onboarding-brand-description">\{description\}<\/p>/);
  assert.match(css, /\.onboarding-brand-header \.onboarding-brand-description[\s\S]*?text-align: center/);
  assert.match(css, /\.onboarding-choice-intro \{ text-align: center; \}/);
});

test('fourth sky-blue theme is selectable and uses the shared palette variables', () => {
  assert.match(profile, /blue: 'আকাশি নীল'/);
  assert.match(profile, /key === 'blue' \? 'droplet'/);
  assert.match(shell, /changeTheme\('blue'\)\}>আকাশি/);
  assert.match(css, /:root\[data-theme="blue"\][\s\S]*?--bg: #edf5fc;[\s\S]*?--primary: #428bc8/);
  assert.match(css, /\.theme-choice-grid \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \}/);
});

test('public screens keep their existing dark palette while the new theme affects the signed-in app', () => {
  assert.match(auth, /document\.documentElement\.dataset\.theme = 'dark'/);
  assert.match(onboarding, /document\.documentElement\.dataset\.theme = 'dark'/);
  assert.match(profile, /localStorage\.setItem\(THEME_KEY, next\)/);
});
