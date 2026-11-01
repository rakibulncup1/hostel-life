import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDhakaFinalizationDue } from '../src/utils/mealPolicy.js';

const service = readFileSync(new URL('../src/services/diningService.js', import.meta.url), 'utf8');
const dining = readFileSync(new URL('../src/features/dining/DiningPage.jsx', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/Run23_same_day_final_meal_entry.sql', import.meta.url), 'utf8');

test('Dhaka finalization boundary is exactly 21:00 and independent of browser timezone', () => {
  assert.equal(isDhakaFinalizationDue('2026-11-01', new Date('2026-11-01T14:59:59.000Z')), false); // 20:59:59 Dhaka
  assert.equal(isDhakaFinalizationDue('2026-11-01', new Date('2026-11-01T15:00:00.000Z')), true); // 21:00 Dhaka
  assert.equal(isDhakaFinalizationDue('2026-11-01', new Date('2026-11-01T15:22:00.000Z')), true); // 21:22 Dhaka
  assert.equal(isDhakaFinalizationDue('2026-11-02', new Date('2026-11-01T15:22:00.000Z')), false);
  assert.equal(isDhakaFinalizationDue('2026-10-31', new Date('2026-11-01T15:22:00.000Z')), false);
});

test('manager meal-entry load refreshes due-day status through the existing lazy-finalization RPC', () => {
  assert.match(service, /if \(isDhakaFinalizationDue\(date, new Date\(\)\)\)\s*\{\s*const \{ error: finalizeError \} = await supabase\.rpc\('get_meal_details'/);
  assert.ok(service.indexOf("supabase.rpc('get_meal_details'") < service.indexOf(".from('daily_meal_days')", service.indexOf('export async function fetchMealEntryData')));
  assert.match(dining, /if \(isDhakaFinalizationDue\(date, new Date\(\)\)\)\s*load\(\)/);
  assert.match(dining, /dayStatus\?\.status === 'finalized'/);
});

test('Run23 allows current date after 21:00, rejects future dates, and finalizes due days before editing', () => {
  const start = migration.indexOf('CREATE OR REPLACE FUNCTION public.manager_set_meal_entries');
  const end = migration.indexOf('$function$;', start) + '$function$;'.length;
  const fn = migration.slice(start, end);
  assert.match(fn, /IF v_date > v_dhaka_today THEN/);
  assert.doesNotMatch(fn, /IF v_date >= v_dhaka_today THEN/);
  assert.match(fn, /v_date = v_dhaka_today AND v_dhaka_now::time < TIME '21:00'/);
  assert.ok(fn.indexOf('private.ensure_period_days(v_period.id)') < fn.indexOf('SELECT * INTO v_day'));
  assert.ok(fn.indexOf('private.finalize_due_days(v_hostel, v_period.id)') < fn.indexOf('SELECT * INTO v_day'));
  assert.match(fn, /assert_hostel_manager\(v_hostel, v_period\.id, false, false\)/);
  assert.match(fn, /v_day\.finalizes_at IS NULL OR v_day\.finalizes_at > clock_timestamp\(\)/);
  assert.match(fn, /v_day\.status <> 'finalized'/);
});
