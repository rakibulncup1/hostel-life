import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const auth = read('src/features/auth/AuthPage.jsx');
const onboarding = read('src/features/onboarding/OnboardingPage.jsx');
const profile = read('src/features/profile/ProfilePage.jsx');
const theme = read('src/app/theme.js');
const switcher = read('src/components/EntryThemeSwitcher.jsx');
const css = read('src/styles/public-entry.css');

 test('auth pages offer the saved four-theme preference without forcing dark mode', () => {
  assert.match(auth, /<EntryThemeSwitcher\s*\/>/);
  assert.match(onboarding, /<EntryThemeSwitcher\s*\/>/);
  assert.match(theme, /THEME_KEY = 'hostel-life-theme'/);
  assert.match(theme, /THEME_VALUES.*system.*light.*dark.*blue/s);
  assert.match(switcher, /saveThemePreference\(nextTheme\)/);
  assert.match(switcher, /aria-pressed=\{theme === option\.value\}/);
  assert.doesNotMatch(auth, /dataset\.theme\s*=\s*'dark'/);
  assert.doesNotMatch(onboarding, /dataset\.theme\s*=\s*'dark'/);
  assert.match(profile, /hostel-life-theme/);
});

test('registration email guidance is plain helper text rather than a boxed info callout', () => {
  assert.match(auth, /className="register-email-note"/);
  assert.match(auth, /সচল ইমেইল ব্যবহার করুন/);
  assert.doesNotMatch(auth, /className="register-email-hint"/);
  assert.match(css, /\.register-email-note/);
  assert.doesNotMatch(css, /\.register-email-note[^{]*\{[^}]*border-left/);
});

test('onboarding offers two compact choices and renders only the selected form', () => {
  assert.match(onboarding, /onboarding-mode-picker/);
  assert.match(onboarding, /aria-pressed=\{mode === 'join'\}/);
  assert.match(onboarding, /aria-pressed=\{mode === 'create'\}/);
  assert.match(onboarding, /mode === 'join' \? \(/);
  assert.match(onboarding, /mode === 'join' \? 'আগে থেকে থাকা মেসে যোগ দিন' : 'নতুন মেস তৈরি'/);
  assert.doesNotMatch(onboarding, /function SetupCard/);
  assert.match(css, /\.onboarding-mode-picker/);
  assert.match(css, /\.onboarding-action-panel/);
});

test('onboarding business actions and security-gated fields remain unchanged', () => {
  assert.match(onboarding, /supabase\.rpc\('join_hostel'/);
  assert.match(onboarding, /supabase\.rpc\('create_hostel_secure'/);
  assert.match(onboarding, /hostelCodeRequired &&/);
  assert.match(onboarding, /setMode\('join'\)/);
  assert.match(onboarding, /setMode\('create'\)/);
});

test('theme switcher is usable on small screens and respects reduced-motion preferences', () => {
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /@media \(max-width: 360px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /:root\[data-theme="blue"\]/);
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /:root\[data-theme="light"\]/);
});
