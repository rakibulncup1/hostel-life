import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20261030_correction_window_server_alignment.sql', import.meta.url), 'utf8');
const dining = await readFile(new URL('../src/features/dining/DiningPage.jsx', import.meta.url), 'utf8');
const policy = await readFile(new URL('../src/utils/mealRequestPolicy.js', import.meta.url), 'utf8');

test('new daily meal rows use previous-day 10 PM cutoff and meal-day 9 PM finalization', () => {
  assert.match(migration, /\(\(v_date - 1\)::timestamp \+ TIME '22:00'\) AT TIME ZONE 'Asia\/Dhaka'/);
  assert.match(migration, /\(v_date::timestamp \+ TIME '21:00'\) AT TIME ZONE 'Asia\/Dhaka'/);
});

test('migration repairs only future open/locked day rows in running periods', () => {
  const repair = migration.slice(migration.indexOf('DO $repair$'), migration.indexOf('-- 2. New day rows'));
  assert.match(repair, /p\.status='running'/);
  assert.match(repair, /d\.meal_date >= p\.start_date/);
  assert.match(repair, /d\.meal_date <= p\.end_date/);
  assert.match(repair, /d\.status IN \('open','locked'\)/);
  assert.match(repair, /\(\(d\.meal_date::timestamp \+ TIME '21:00'\) AT TIME ZONE 'Asia\/Dhaka'\) > clock_timestamp\(\)/);
  assert.match(repair, /SET cutoff_at = .*finalizes_at =/s);
  assert.match(repair, /d\.finalizes_at IS DISTINCT FROM/);
  assert.doesNotMatch(repair, /SET status\s*=/i);
  assert.doesNotMatch(repair, /UPDATE public\.daily_meal_records/i);
});

test('request creation server checks cutoff passed and finalization is still in the future', () => {
  const internal = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION private.create_meal_request_internal'), migration.indexOf('-- 4. Correction requests'));
  assert.match(internal, /d\.status not in \('open','locked'\)/);
  assert.match(internal, /d\.cutoff_at > v_now/);
  assert.match(internal, /d\.finalizes_at <= v_now/);
  assert.match(internal, /TIME '22:00'/);
  assert.match(internal, /TIME '21:00'/);
});

test('member correction RPC is single-day, target-date-only, and validates authoritative day state', () => {
  const correction = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.create_meal_correction_request'), migration.indexOf('-- 5. Manager approval'));
  assert.match(correction, /jsonb_array_length\(p_days\) <> 1/);
  assert.match(correction, /p_start_date IS DISTINCT FROM v_target/);
  assert.match(correction, /v_day\.status NOT IN \('open','locked'\)/);
  assert.match(correction, /v_day\.cutoff_at > v_now/);
  assert.match(correction, /v_day\.finalizes_at <= v_now/);
});

test('migration fails closed and rolls back if future active schedule rows remain invalid', () => {
  assert.match(migration, /DO \$postflight_guard\$/);
  assert.match(migration, /Correction-window postflight failed; the entire migration was rolled back/);
  assert.match(migration, /COMMIT;[\s\S]*no_invalid_active_correction_windows/);
});

test('manager approval applies the same cutoff/finalization rule after finalizing due days', () => {
  const review = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.manager_review_correction'), migration.indexOf('COMMIT;'));
  assert.match(review, /PERFORM private\.finalize_due_days/);
  assert.match(review, /v_day\.status NOT IN \('open','locked'\)/);
  assert.match(review, /v_day\.cutoff_at > v_now/);
  assert.match(review, /v_day\.finalizes_at <= v_now/);
  assert.match(review, /PERFORM private\.apply_request_days/);
});

test('UI exposes correction action only when stored cutoff has passed and finalization is still ahead', () => {
  assert.match(policy, /export function isCorrectionDayEligible/);
  assert.match(policy, /cutoffMs <= nowMs && finalizesMs > nowMs/);
  assert.match(dining, /isCorrectionDayEligible\(date, dayStateMap\.get\(date\), new Date\(historyClock\)\)/);
});
