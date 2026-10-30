import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getMealPartsTotal } from '../src/utils/mealTotals.js';

const dashboard = readFileSync(new URL('../src/features/dashboard/DashboardPage.jsx', import.meta.url), 'utf8');

test('member meal total is derived from breakfast, lunch and dinner when RPC omits total_meals', () => {
  assert.equal(getMealPartsTotal({ breakfast: 1, lunch: 0.5, dinner: 1 }), 2.5);
});

test('member meal total safely handles null, missing and non-numeric component values', () => {
  assert.equal(getMealPartsTotal({ breakfast: '2', lunch: null, dinner: 'not-a-number' }), 2);
  assert.equal(getMealPartsTotal(null), 0);
});

test('daily details use the derived total helper rather than the absent total_meals field directly', () => {
  assert.match(dashboard, /formatMeal\(getDisplayedDailyMealTotal\(row\)\)/);
  assert.match(dashboard, /meal\.total \?\? meal\.total_meals/);
});
