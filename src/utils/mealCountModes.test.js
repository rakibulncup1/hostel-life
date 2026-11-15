import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MEAL_COUNT_MODES, getMealPeopleCount, normalizeMealCountModes } from './mealCountModes.js';

test('default serving modes preserve the existing half-breakfast convention', () => {
  assert.deepEqual(normalizeMealCountModes(null), DEFAULT_MEAL_COUNT_MODES);
});

test('normalization accepts only half/full and restores invalid entries to defaults', () => {
  assert.deepEqual(normalizeMealCountModes({ breakfast: 'full', lunch: 'invalid', dinner: 'half' }), {
    breakfast: 'full', lunch: 'full', dinner: 'half',
  });
});

test('invalid serialized settings safely fall back to the defaults', () => {
  assert.deepEqual(normalizeMealCountModes('{broken-json'), DEFAULT_MEAL_COUNT_MODES);
});

test('half portions display the equivalent number of people without changing stored units', () => {
  assert.equal(getMealPeopleCount(5, 'half'), 10);
  assert.equal(getMealPeopleCount(10, 'full'), 10);
  assert.equal(getMealPeopleCount(2.5, 'half'), 5);
  assert.equal(getMealPeopleCount('invalid', 'half'), 0);
});
