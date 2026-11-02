import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const auth = readFileSync(new URL('../src/features/auth/AuthPage.jsx', import.meta.url), 'utf8');
const onboarding = readFileSync(new URL('../src/features/onboarding/OnboardingPage.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles/ui-refresh.css', import.meta.url), 'utf8');
const entryCss = readFileSync(new URL('../src/styles/public-entry.css', import.meta.url), 'utf8');

test('mobile auth headings are centered without changing desktop alignment', () => {
  const mobileBlock = css.match(/@media\s*\(max-width:\s*849px\)\s*\{[\s\S]*?\.auth-page \.auth-form-panel \.auth-header[\s\S]*?\n\}/);
  assert.ok(mobileBlock, 'mobile auth header rule exists');
  assert.match(mobileBlock[0], /text-align:\s*center/);
  assert.match(auth, /আবারও স্বাগতম/);
  assert.match(auth, /নতুন যাত্রা শুরু হোক/);
});

test('dark auth and onboarding inputs use readable foreground and autofill colors', () => {
  assert.match(css, /\.auth-form-panel \.password-field input,[\s\S]*?background:\s*#172820;[\s\S]*?color:\s*#f3faf5/);
  assert.match(css, /-webkit-text-fill-color:\s*#f3faf5\s*!important/);
  assert.match(css, /color:\s*#a4b9aa/);
});

test('password reset policy is styled as a readable information card', () => {
  assert.match(auth, /className="password-reset-policy"/);
  assert.match(css, /\.auth-form-panel \.password-reset-policy\s*\{[\s\S]*?border-radius:\s*15px/);
  assert.match(css, /\.auth-form-panel \.password-reset-policy p\s*\{[\s\S]*?line-height:\s*1\.75/);
});

test('join and create choices use compact selection buttons and one focused form panel', () => {
  assert.match(onboarding, /onboarding-mode-option/);
  assert.match(onboarding, /onboarding-action-panel/);
  assert.match(entryCss, /\.onboarding-mode-picker/);
  assert.match(entryCss, /\.onboarding-action-panel/);
});

test('system and manager notices retain near-full-width layout with soft rounded corners', () => {
  assert.match(css, /\.global-announcement\s*\{[\s\S]*?width:\s*calc\(100% - clamp\(20px, 2\.8vw, 40px\)\)[\s\S]*?border-radius:\s*15px/);
  assert.match(css, /\.global-system-announcement\s*\{\s*border-color:/);
  assert.match(css, /\.hostel-manager-announcement\s*\{\s*border-color:/);
});
