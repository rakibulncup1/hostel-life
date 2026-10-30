import test from 'node:test';
import assert from 'node:assert/strict';
import { canCorrectMealDay, canSubmitMealDay } from '../src/utils/mealPolicy.js';

test('correction request is allowed after previous-night cutoff and before 9 PM finalization', () => {
  const day = {
    meal_date: '2026-10-20',
    status: 'locked',
    cutoff_at: '2026-10-19T16:00:00.000Z', // previous date 22:00 Dhaka
    finalizes_at: '2026-10-20T15:00:00.000Z', // meal date 21:00 Dhaka
  };
  assert.equal(canCorrectMealDay(day, new Date('2026-10-20T00:01:00.000Z')), true);
});

test('correction request is not allowed before cutoff or after finalization', () => {
  const beforeCutoff = {
    meal_date: '2026-10-20', status: 'open',
    cutoff_at: '2026-10-20T15:00:00.000Z', finalizes_at: '2026-10-20T15:00:00.000Z',
  };
  const afterFinalization = {
    meal_date: '2026-10-20', status: 'finalized',
    cutoff_at: '2026-10-19T16:00:00.000Z', finalizes_at: '2026-10-20T15:00:00.000Z',
  };
  assert.equal(canCorrectMealDay(beforeCutoff, new Date('2026-10-20T00:01:00.000Z')), false);
  assert.equal(canCorrectMealDay(afterFinalization, new Date('2026-10-20T15:01:00.000Z')), false);
});

test('cancelled day cannot be corrected and finalized day cannot be directly submitted/edited', () => {
  assert.equal(canCorrectMealDay({
    meal_date: '2026-10-20', status: 'cancelled',
    cutoff_at: '2026-10-19T16:00:00.000Z', finalizes_at: '2026-10-20T15:00:00.000Z',
  }, new Date('2026-10-20T10:00:00.000Z')), false);
  assert.equal(canSubmitMealDay({ meal_date: '2026-10-20', status: 'finalized', cutoff_at: '2026-10-20T15:00:00.000Z' }, new Date('2026-10-20T14:00:00.000Z')), false);
});
