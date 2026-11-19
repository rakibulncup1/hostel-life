import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('Run80 application overrides load after Run79 and remain a separate stylesheet', () => {
  const entry = read('src/main.jsx');
  assert.ok(entry.indexOf('run80-focused-profile-auth.css') > entry.indexOf('run79-cohesive-theme-and-layout.css'));
  assert.match(entry, /run80-focused-profile-auth\.css/);
});

test('Profile detail copy has transparent row backgrounds in dark theme', () => {
  const css = read('src/styles/run80-focused-profile-auth.css');
  assert.match(css, /\.profile-experience \.profile-detail-list > div[\s\S]*?background:\s*transparent\s*!important/i);
  assert.match(css, /\.profile-experience \.profile-detail-list span[\s\S]*?background:\s*transparent\s*!important/i);
  assert.match(css, /--profile-blue-bg:\s*#354049/i);
  assert.match(css, /profile-identity-card[\s\S]*?linear-gradient\(120deg, #2d353d 0%, #354049 100%\)/i);
});

test('Dashboard member search uses a neutral wrapper and transparent input', () => {
  const css = read('src/styles/run80-focused-profile-auth.css');
  assert.match(css, /dashboard-member-search\s*\{[\s\S]*?background:\s*#2d353d/i);
  assert.match(css, /dashboard-member-search input\s*\{[\s\S]*?background:\s*transparent\s*!important/i);
});

test('Authentication links are text-only and no longer inherit dark button fills', () => {
  const css = read('src/styles/run80-focused-profile-auth.css');
  assert.match(css, /auth-form-panel \.text-button[\s\S]*?background:\s*transparent\s*!important/i);
  assert.match(css, /auth-form-panel \.auth-switch\s*\{[\s\S]*?background:\s*transparent/i);
});

test('Dark auth branding and inputs use the shared graphite surfaces', () => {
  const css = read('src/styles/run80-focused-profile-auth.css');
  assert.match(css, /auth-brand-panel\s*\{[\s\S]*?background:\s*linear-gradient\(150deg, #354049 0%, #303941 55%, #2d353d 100%\)/i);
  assert.match(css, /auth-form-panel \.field-label input[\s\S]*?background:\s*#252d34/i);
  assert.match(css, /auth-brand-mark svg rect:first-child[\s\S]*?fill:\s*#46525a/i);
  assert.doesNotMatch(css, /#19875b|#20a46e|#183328|#12271e/i);
});

test('Dark Forgot/Reset compact shell is narrow, single-column and retains its form', () => {
  const css = read('src/styles/run80-focused-profile-auth.css');
  const auth = read('src/features/auth/AuthPage.jsx');
  assert.match(css, /auth-shell\.auth-shell-compact\s*\{[\s\S]*?width:\s*min\(500px, 100%\)/i);
  assert.match(css, /auth-shell-compact \.auth-brand-panel\s*\{\s*display:\s*none/i);
  assert.match(auth, /forgot-password/);
  assert.match(auth, /password-reset-policy/);
});

test('About dark theme explicitly covers showcase, workflow and nested preview surfaces', () => {
  const page = read('public/about.html');
  const css = read('public/landing-assets/run80-about-dark-clarity.css');
  assert.match(page, /run80-about-dark-clarity\.css/);
  for (const selector of ['.showcase-section', '.workflow-card', '.feature-image-frame', '.showcase-media', '.report-metric-grid > div', '.request-table-row']) {
    assert.ok(css.includes(selector), `Missing dark coverage for ${selector}`);
  }
});

test('English meal-rate labels have explicit stable translation keys', () => {
  const dashboard = read('src/features/dashboard/DashboardPage.jsx');
  const about = read('public/about.html');
  const runtime = read('public/language-runtime.js');
  const extra = read('public/app-english-translations.js');
  assert.match(dashboard, /data-i18n-key=\{label === 'মিল রেট' \? 'dashboard\.mealRate'/);
  assert.match(dashboard, /data-i18n-key="dashboard\.currentMealRate">বর্তমান মিল রেট/);
  assert.match(about, /data-i18n-key="about\.report\.mealRate">মিল রেট/);
  for (const key of ['dashboard.mealRate', 'dashboard.currentMealRate', 'about.report.mealRate']) {
    assert.ok(runtime.includes(`'${key}'`), `Runtime translation missing ${key}`);
    assert.ok(extra.includes(`"${key}"`), `English bundle translation missing ${key}`);
  }
});

test('Run80 changes presentation and explicit translation labels only, not auth/profile service logic', () => {
  const changedCode = read('src/features/dashboard/DashboardPage.jsx');
  assert.match(changedCode, /data-i18n-key="dashboard\.currentMealRate"/);
  assert.match(changedCode, /data-i18n-key=\{label === 'মিল রেট'/);
  const css = read('src/styles/run80-focused-profile-auth.css');
  assert.doesNotMatch(css, /pointer-events:\s*none|display:\s*none[^;]*!important/i);
  assert.match(css, /@media \(min-width: 701px\)/);
});
