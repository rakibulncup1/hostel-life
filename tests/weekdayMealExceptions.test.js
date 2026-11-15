import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WEEKDAY_OPTIONS_BN,
  applyWeekdayMealExceptions,
  buildMealDaysForRange,
  getMealWeekdayIndex,
} from '../src/utils/weekdayMealExceptions.js';

const DEFAULTS = { breakfast: 0.5, lunch: 1, dinner: 1 };

test('weekday lookup follows calendar dates independent of local timezone', () => {
  assert.equal(getMealWeekdayIndex('2026-11-13'), 5); // Friday
  assert.equal(getMealWeekdayIndex('2026-11-14'), 6); // Saturday
  assert.equal(getMealWeekdayIndex('2026-11-15'), 0); // Sunday
  assert.equal(getMealWeekdayIndex('2026-02-30'), -1);
});

test('weekday options expose seven unique Bengali days', () => {
  assert.equal(WEEKDAY_OPTIONS_BN.length, 7);
  assert.equal(new Set(WEEKDAY_OPTIONS_BN.map((item) => item.value)).size, 7);
});

test('date range generates each calendar day inclusively', () => {
  const days = buildMealDaysForRange('2026-11-28', '2026-12-02', DEFAULTS);
  assert.deepEqual(days.map((day) => day.meal_date), [
    '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02',
  ]);
  assert.equal(days.length, 5);
});

test('range change preserves existing manual edits and defaults only new dates', () => {
  const existing = [
    { meal_date: '2026-11-13', breakfast: 2, lunch: 0, dinner: 0.5 },
    { meal_date: '2026-11-14', breakfast: 0, lunch: 1, dinner: 1 },
  ];
  const days = buildMealDaysForRange('2026-11-13', '2026-11-15', DEFAULTS, existing);
  assert.deepEqual(days[0], existing[0]);
  assert.deepEqual(days[1], existing[1]);
  assert.deepEqual(days[2], { meal_date: '2026-11-15', ...DEFAULTS });
});

test('multiple weekday exceptions apply to every matching day in range', () => {
  const exceptions = [
    { weekday: 5, breakfast: 0.5, lunch: 2, dinner: 0 },
    { weekday: 2, breakfast: 0, lunch: 1.5, dinner: 0.5 },
  ];
  const days = buildMealDaysForRange('2026-11-10', '2026-11-24', DEFAULTS, [], exceptions);
  const fridayDays = days.filter((day) => getMealWeekdayIndex(day.meal_date) === 5);
  const tuesdayDays = days.filter((day) => getMealWeekdayIndex(day.meal_date) === 2);
  assert.equal(fridayDays.length, 2);
  assert.ok(fridayDays.every((day) => day.breakfast === 0.5 && day.lunch === 2 && day.dinner === 0));
  assert.equal(tuesdayDays.length, 3);
  assert.ok(tuesdayDays.every((day) => day.breakfast === 0 && day.lunch === 1.5 && day.dinner === 0.5));
});

test('weekday exceptions do not mutate original day objects', () => {
  const original = [{ meal_date: '2026-11-13', breakfast: 0.5, lunch: 1, dinner: 1 }];
  const result = applyWeekdayMealExceptions(original, [{ weekday: 5, breakfast: 1, lunch: 0, dinner: 0 }]);
  assert.deepEqual(original[0], { meal_date: '2026-11-13', breakfast: 0.5, lunch: 1, dinner: 1 });
  assert.deepEqual(result[0], { meal_date: '2026-11-13', breakfast: 1, lunch: 0, dinner: 0 });
});

test('invalid date ranges return an empty day list', () => {
  assert.deepEqual(buildMealDaysForRange('2026-11-15', '2026-11-14', DEFAULTS), []);
  assert.deepEqual(buildMealDaysForRange('', '2026-11-14', DEFAULTS), []);
  assert.deepEqual(buildMealDaysForRange('2026-1-14', '2026-11-15', DEFAULTS), []);
  assert.deepEqual(buildMealDaysForRange('2026-11-14T00:00:00Z', '2026-11-15', DEFAULTS), []);
});
