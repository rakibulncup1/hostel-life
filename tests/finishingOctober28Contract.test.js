import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../supabase/migrations/Run11.sql', import.meta.url), 'utf8');
const dining = await readFile(new URL('../src/features/dining/DiningPage.jsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8');
const platform = await readFile(new URL('../src/features/platform/SuperAdminPage.jsx', import.meta.url), 'utf8');
const dialogs = await readFile(new URL('../src/utils/actionDialogs.js', import.meta.url), 'utf8');

test('October patch uses an atomic incremental SQL transaction, not a reset', () => {
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /COMMIT;/);
  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION public\./g) || []).length, 4);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|DELETE FROM public\.monthly_periods/i);
});
test('late requests enforce Dhaka 22:00 through next 21:00 at RPC boundary', () => {
  assert.match(sql, /IF v_local_now::time >= TIME '21:00' AND v_local_now::time < TIME '22:00'/);
  assert.match(sql, /CASE WHEN v_local_now::time >= TIME '22:00' THEN v_today \+ 1 ELSE v_today END/);
  assert.match(sql, /d\.status IN \('finalized','cancelled'\)/);
});
test('a locked tomorrow cannot be modified OR deleted by editing later days', () => {
  assert.match(sql, /IF v_date = v_today \+ 1 AND \(now\(\) AT TIME ZONE 'Asia\/Dhaka'\)::time >= TIME '22:00'/);
  assert.match(sql, /old_day\.value->>'meal_date'\)::date = v_today \+ 1/);
  assert.match(sql, /AND NOT \(d\.meal_date = v_today \+ 1 AND/);
});
test('member corrections restrict to currently eligible day and stop after finalization', () => {
  assert.match(sql, /IF v_date <> v_target THEN/);
  assert.match(sql, /v_day\.status = 'cancelled' OR v_day\.status = 'finalized'/);
  assert.match(sql, /IF v_day\.status = 'finalized' THEN[\s\S]*?দিনটির হিসাব চূড়ান্ত/);
});
test('new requests do not show a misleading empty server day-row warning', () => {
  assert.match(dining, /: days\.length === 0\)/);
  assert.doesNotMatch(dining, /এই তারিখের পরিসরে জমা বা সম্পাদনার উপযোগী দিন পাওয়া যায়নি/);
});
test('meal day cards remain within phone viewport at small widths', () => {
  assert.match(styles, /\.dining-panel \.meal-day-fields \{display:grid; grid-template-columns:1fr/);
  assert.match(styles, /\.dining-panel \.meal-stepper \{display:grid; grid-template-columns:32px minmax\(28px,40px\) 32px/);
});
test('permanent deletion asks for exact visible phrase without browser prompt', () => {
  assert.match(platform, /DELETE HOSTEL \$\{selected\.hostel_id\}/);
  assert.match(platform, /deleteConfirmation\.trim\(\) !== required/);
  assert.doesNotMatch(platform, /window\.(confirm|prompt|alert)/);
  assert.match(dialogs, /confirmTypedAction/);
});
