import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('Run66 performs a versioned one-time Light theme rollout, then preserves user choice', () => {
  const source = read('src/app/theme.js');
  assert.match(source, /THEME_ROLLOUT_KEY/);
  assert.match(source, /THEME_ROLLOUT_VERSION/);
  assert.match(source, /migrateThemePreferenceToLightOnce/);
  assert.match(source, /setItem\(THEME_KEY, 'light'\)/);
  assert.match(source, /getItem\(THEME_ROLLOUT_KEY\) === THEME_ROLLOUT_VERSION/);
  assert.match(source, /saveThemePreference\(theme\)/);
  assert.match(source, /return readThemeKey\(THEME_KEY\).*'light'/s);
});

test('Run66 app ignores platform appearance setting while retaining public settings fetch', () => {
  const source = read('src/app/App.jsx');
  assert.match(source, /fetchPlatformPublicSettings/);
  assert.match(source, /applyTheme\(getThemePreference\(\)\)/);
  assert.doesNotMatch(source, /applyPlatformDefaultTheme\(settings\.default_theme\)/);
});

test('Run66 keeps personal theme selection and removes Super Admin global control', () => {
  const profile = read('src/features/profile/ProfilePage.jsx');
  const admin = read('src/features/platform/SuperAdminPage.jsx');
  assert.match(profile, /saveThemePreference/);
  assert.match(profile, /getThemePreference/);
  assert.doesNotMatch(admin, /\['appearance','অ্যাপের থিম'\]/);
  assert.doesNotMatch(admin, /tab === 'appearance'/);
  assert.doesNotMatch(admin, /platformAdminSetDefaultTheme/);
});

test('Run66 theme migration only changes platform default and disables the specific setter RPC', () => {
  const sql = read('supabase/migrations/Run66_light_default_theme_rollout.sql');
  assert.match(sql, /ALTER COLUMN default_theme SET DEFAULT 'light'/);
  assert.match(sql, /SET default_theme = 'light'/);
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.platform_admin_set_default_theme\(text\)/);
  assert.doesNotMatch(sql, /DROP FUNCTION|DROP TABLE|TRUNCATE|DELETE FROM/i);
});

test('Run66 exception editor gains a full-width mobile layout without changing request handlers', () => {
  const css = read('src/styles/run66-theme-exception-fit.css');
  const page = read('src/features/dining/DiningPage.jsx');
  assert.match(css, /max-width: 620px/);
  assert.match(css, /weekday-exception-meals \{\s*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(page, /onClick=\{saveWeekdayException\}/);
  assert.match(page, /setExceptionEditorOpen\(true\)/);
});

test('Run66 aligns today and late request summary groups with their detail card insets', () => {
  const css = read('src/styles/run66-theme-exception-fit.css');
  assert.match(css, /\.detail-total-strip\s*\{[^}]*margin: 12px 14px 10px/);
  assert.match(css, /\.late-request-detail-totals\s*\{[^}]*margin: 12px 14px 10px/);
  assert.match(css, /\.upcoming-meal-days\s*\{[^}]*padding-inline: 0/);
});

test('Run66 gives How-to timing cards a non-overlapping responsive grid', () => {
  const css = read('src/styles/run66-theme-exception-fit.css');
  assert.match(css, /\.howto-time-grid\s*\{\s*display: grid/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /overflow-wrap: anywhere/);
});
