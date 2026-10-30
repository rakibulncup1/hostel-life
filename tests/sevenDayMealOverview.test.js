import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUpcomingMealDays, formatUpcomingMealDate } from '../src/utils/sevenDayMeals.js';
import { getSevenDates } from '../src/services/sevenDayMealStore.js';

const dates = [
  '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04',
  '2026-11-05', '2026-11-06', '2026-11-07',
];

test('next seven dates use Asia/Dhaka and begin tomorrow, including month boundaries', () => {
  // 19:00 UTC on Oct 30 is 01:00 on Oct 31 in Dhaka, so the next day is Nov 1.
  assert.deepEqual(getSevenDates(new Date('2026-10-30T19:00:00.000Z')), dates);
});

test('builds three meal totals and grand total from server-applied rows', () => {
  const result = buildUpcomingMealDays([
    {
      planned_breakfast: 1, planned_lunch: 0.5, planned_dinner: 1,
      daily_meal_days: { meal_date: dates[0], status: 'open' }, cancelled: false,
    },
    {
      planned_breakfast: 2, planned_lunch: 1, planned_dinner: 0,
      daily_meal_days: { meal_date: dates[0], status: 'open' }, cancelled: false,
    },
    {
      planned_breakfast: 8, planned_lunch: 8, planned_dinner: 8,
      daily_meal_days: { meal_date: dates[0], status: 'open' }, cancelled: true,
    },
  ], dates);

  assert.equal(result.length, 7);
  assert.deepEqual(result[0], {
    meal_date: dates[0], breakfast: 3, lunch: 1.5, dinner: 1, total: 5.5, within_period: true,
  });
  assert.deepEqual(result[1], {
    meal_date: dates[1], breakfast: 0, lunch: 0, dinner: 0, total: 0, within_period: true,
  });
});

test('finalized days use final values and emergency overrides use actual values', () => {
  const result = buildUpcomingMealDays([
    {
      planned_breakfast: 1, actual_breakfast: 2, final_breakfast: 3,
      planned_lunch: 1, actual_lunch: 2, final_lunch: 3,
      planned_dinner: 1, actual_dinner: 2, final_dinner: 3,
      daily_meal_days: { meal_date: dates[0], status: 'finalized' },
    },
    {
      planned_breakfast: 1, actual_breakfast: 2,
      planned_lunch: 1, actual_lunch: 2,
      planned_dinner: 1, actual_dinner: 2,
      finalization_source: 'emergency_override',
      daily_meal_days: { meal_date: dates[1], status: 'open' },
    },
  ], dates);

  assert.deepEqual([result[0].breakfast, result[0].lunch, result[0].dinner, result[0].total], [3, 3, 3, 9]);
  assert.deepEqual([result[1].breakfast, result[1].lunch, result[1].dinner, result[1].total], [2, 2, 2, 6]);
});

test('marks dates outside the active period without treating them as available meal dates', () => {
  const result = buildUpcomingMealDays([], dates, {
    periodStartDate: '2026-10-01',
    periodEndDate: '2026-11-01',
  });
  assert.equal(result[0].within_period, true);
  assert.equal(result[1].within_period, false);
});

test('formats upcoming dates without relying on the browser local timezone', () => {
  assert.match(formatUpcomingMealDate('2026-11-01'), /১|1/);
});
