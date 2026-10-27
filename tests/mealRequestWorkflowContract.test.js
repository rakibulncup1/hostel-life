import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20261027_finishing_reliability.sql', import.meta.url), 'utf8');
const dining = await readFile(new URL('../src/features/dining/DiningPage.jsx', import.meta.url), 'utf8');
const policy = await readFile(new URL('../src/utils/mealPolicy.js', import.meta.url), 'utf8');

const normalSql = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.create_meal_request('), migration.indexOf('CREATE OR REPLACE FUNCTION public.create_late_meal_request('));
const lateSql = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.create_late_meal_request('), migration.indexOf('-- 7. Corrections'));
const correctionSql = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.create_meal_correction_request('), migration.indexOf('-- 8. Direct edit'));
const editSql = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.edit_my_approved_meal_request('), migration.indexOf('REVOKE ALL ON FUNCTION public.create_meal_request'));

test('normal member request RPC enforces the 10 PM Dhaka cutoff even if frontend is bypassed', () => {
  assert.match(normalSql, /now\(\) AT TIME ZONE 'Asia\/Dhaka'/);
  assert.match(normalSql, /v_local_now::time >= TIME '22:00'/);
  assert.match(dining, /isNormalMealRequestWindowOpen\(new Date\(\)\)/);
  assert.match(dining, /normalCreateLocked/);
});

test('late request opens only after 10 PM, targets tomorrow, and checks active duplicates', () => {
  assert.match(lateSql, /v_local_now::time < TIME '22:00'/);
  assert.match(lateSql, /p_meal_date IS DISTINCT FROM \(v_today \+ 1\)/);
  assert.match(lateSql, /r\.status IN \('submitted','approved'\)/);
  assert.match(dining, /function lateMealRequestTargetDate\(\)\s*\{\s*return getLateMealRequestTargetDate\(new Date\(\)\)/);
});

test('correction request requires parent approved normal request and cutoff/finalized date', () => {
  assert.match(correctionSql, /v_parent\.status <> 'approved'/);
  assert.match(correctionSql, /v_parent\.request_type <> 'normal'/);
  assert.match(correctionSql, /v_parent\.is_late_request/);
  assert.match(correctionSql, /v_day\.status IS DISTINCT FROM 'finalized'/);
  assert.match(correctionSql, /existing\.status = 'submitted'/);
  assert.match(policy, /day\.status === 'finalized' \|\| isCutoffPassed/);
});

test('request history checks current period and scopes meal-day status lookups to that period', () => {
  const history = dining.slice(dining.indexOf('function RequestHistory('), dining.indexOf('function MarketEntryForm('));
  assert.match(history, /fetchRunningPeriod\(\{ force: true \}\)/);
  assert.match(history, /String\(row\.period_id \|\| ''\) === String\(activePeriodId\)/);
  assert.match(history, /fetchMealDayStates\(dates\[0\], dates\[dates\.length - 1\], activePeriodId\)/);
  assert.match(history, /requestIsInRunningPeriod && days\.some/);
});

test('direct request edits preserve finalized history and update meal records transactionally', () => {
  assert.match(editSql, /v_preserved_days/);
  assert.match(editSql, /UPDATE public\.daily_meal_records r[\s\S]*?SET cancelled = true/);
  assert.match(editSql, /INSERT INTO public\.daily_meal_records/);
  assert.match(editSql, /planned_breakfast = EXCLUDED\.planned_breakfast/);
  assert.match(editSql, /'preserved_protected_days'/);
});


test('manager correction approval supports finalized days without allowing cancelled or stale-parent corrections', () => {
  const review = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.manager_review_correction('), migration.indexOf('REVOKE ALL ON FUNCTION public.manager_review_correction'));
  assert.match(review, /v_parent\.status <> 'approved'/);
  assert.match(review, /v_period\.status <> 'running'/);
  assert.match(review, /v_day\.status <> 'finalized'/);
  assert.match(review, /v_day\.status = 'cancelled'/);
  assert.match(review, /PERFORM private\.apply_request_days\(v_req\.id\)/);
  assert.doesNotMatch(review, /v_day\.status in \('finalized','cancelled'\).*errcode/);
});


test('manager request-list RPC returns an empty list when no running period matches', () => {
  const listFn = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.get_manager_meal_requests_v3('), migration.indexOf('-- 6. Enforce the 10 PM normal-request cutoff'));
  assert.match(listFn, /WHERE hostel_id = v_hostel AND status = 'running'/);
  assert.match(listFn, /IF NOT FOUND THEN\s*RETURN '\[\]'::jsonb;/);
  assert.match(listFn, /AND r\.period_id = v_period/);
});

test('reopening an accidental close preserves cutoff/finalization timestamps and never reopens cancelled days', () => {
  const reopen = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.reopen_archived_period('), migration.indexOf('REVOKE ALL ON FUNCTION public.get_archive_management_items()'));
  assert.match(reopen, /cutoff_at, finalizes_at/);
  assert.match(reopen, /TIME '21:00'\) AT TIME ZONE 'Asia\/Dhaka'/);
  assert.match(reopen, /COALESCE\(finalizes_at,[\s\S]*?<= now\(\)/);
  assert.match(reopen, /WHERE period_id = v_period\.id AND status <> 'cancelled'/);
});

test('request history explains why edit/correction controls are withheld if day metadata fails to load', () => {
  const history = dining.slice(dining.indexOf('function RequestHistory('), dining.indexOf('function MarketEntryForm('));
  assert.match(history, /setDayStateError\('দিনের সময়সীমার তথ্য লোড করা যায়নি/);
  assert.match(history, /dayStateError && <div className="meal-policy-note is-warning"/);
});
