import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/Run9.sql', import.meta.url), 'utf8');
const dining = await readFile(new URL('../src/features/dining/DiningPage.jsx', import.meta.url), 'utf8');
const manager = await readFile(new URL('../src/features/manager/ManagerPages.jsx', import.meta.url), 'utf8');

test('open-ended-period migration stores a private sentinel and closes on Dhaka date', () => {
  assert.match(migration, /NEW\.end_date := DATE '9999-12-31'/);
  assert.match(migration, /v_today date := \(now\(\) AT TIME ZONE 'Asia\/Dhaka'\)::date/);
  assert.match(migration, /OLD\.status = 'running' AND NEW\.status IN \('closed','archived'\)/);
  assert.match(migration, /NEW\.end_date := v_today/);
});

test('period migration creates missing requested days without generating rows to the sentinel', () => {
  assert.match(migration, /v_stop := CASE WHEN v_period\.status = 'running' THEN v_today ELSE v_period\.end_date END/);
  assert.match(migration, /INSERT INTO public\.daily_meal_days/);
  assert.match(migration, /hl_ensure_running_period_days/);
});

test('new future meal-request dates can be checked server-side even without a pre-created day row', () => {
  assert.match(dining, /isEdit \? !canDirectEditMealDate\(day, new Date\(clock\)\)/);
  assert.match(dining, /Boolean\(dayState && !canSubmitMealDay\(dayState\)\)/);
  assert.match(migration, /IF NOT FOUND THEN\s+INSERT INTO public\.daily_meal_days/);
});

test('same-calendar-month period labels still use Part 2 and preserve old labels', () => {
  assert.match(migration, /private\.hl_b_label_duplicate_month\(\)/);
  assert.match(migration, /date_trunc\('month', p\.start_date::timestamp\) = date_trunc\('month', NEW\.start_date::timestamp\)/);
  assert.match(migration, /' \(Part ' \|\| v_number::text \|\| '\)'/);
  assert.match(migration, /BEFORE INSERT ON public\.monthly_periods/);
});

test('running reports show an open period instead of an internal sentinel date', () => {
  assert.match(manager, /function currentPeriodRange\(period\)/);
  assert.match(manager, /period\?\.end_date[\s\S]*?থেকে চলমান/);
});


test('future-start guard permits only end-date normalization of an unchanged existing running row', () => {
  assert.match(migration, /IF TG_OP = 'INSERT' THEN[\s\S]*?নতুন মাস শুরুর তারিখ আসার আগে সেটি চালু করা যাবে না/);
  assert.match(migration, /OLD\.status IS DISTINCT FROM 'running'[\s\S]*?OLD\.start_date IS DISTINCT FROM NEW\.start_date[\s\S]*?to_jsonb\(OLD\) - 'end_date'[\s\S]*?to_jsonb\(NEW\) - 'end_date'/);
  assert.match(migration, /UPDATE public\.monthly_periods\s+SET end_date = DATE '9999-12-31'\s+WHERE status = 'running'/);
});
