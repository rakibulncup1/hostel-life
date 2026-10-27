import test from 'node:test';
import assert from 'node:assert/strict';
import { canCorrectMealDay, canSubmitMealDay } from '../src/utils/mealPolicy.js';

test('correction request is allowed for cutoff-passed day that is not finalized yet', () => {
  assert.equal(canCorrectMealDay({ meal_date: '2026-10-20', status: 'locked', cutoff_at: '2026-10-20T15:00:00.000Z' }, new Date('2026-10-20T15:01:00.000Z')), true);
});

test('correction request remains available for a finalized day because backend applies it with manager approval', () => {
  assert.equal(canCorrectMealDay({ meal_date: '2026-10-20', status: 'finalized', cutoff_at: null }, new Date('2026-10-20T10:00:00.000Z')), true);
});

test('cancelled day cannot be corrected and finalized day cannot be directly submitted/edited', () => {
  assert.equal(canCorrectMealDay({ meal_date: '2026-10-20', status: 'cancelled', cutoff_at: '2026-10-20T15:00:00.000Z' }, new Date('2026-10-20T16:00:00.000Z')), false);
  assert.equal(canSubmitMealDay({ meal_date: '2026-10-20', status: 'finalized', cutoff_at: '2026-10-20T15:00:00.000Z' }, new Date('2026-10-20T14:00:00.000Z')), false);
});
