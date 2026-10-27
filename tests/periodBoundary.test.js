import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarMonthEnd, getSplitPeriodBoundaryRepair } from '../src/utils/periodBoundary.js';

test('calendar month end uses the period start month and handles February leap years', () => {
  assert.equal(calendarMonthEnd('2026-10-17'), '2026-10-31');
  assert.equal(calendarMonthEnd('2024-02-12'), '2024-02-29');
  assert.equal(calendarMonthEnd('2026-02-01'), '2026-02-28');
  assert.equal(calendarMonthEnd('not-a-date'), null);
});

test('split period can be offered a confirmed end-date repair when the target lies inside that month', () => {
  const period = { label: 'Oct 2026 (Part 2)', start_date: '2026-10-17', end_date: '2026-10-17', status: 'running' };
  assert.deepEqual(getSplitPeriodBoundaryRepair(period, '2026-10-28'), {
    needsRepair: true, startDate: '2026-10-17', endDate: '2026-10-17', targetDate: '2026-10-28', monthEnd: '2026-10-31',
  });
});

test('does not suggest extension if the target is in range, outside the current calendar month, or the period starts on day one', () => {
  assert.equal(getSplitPeriodBoundaryRepair({start_date:'2026-10-17',end_date:'2026-10-31'}, '2026-10-28').needsRepair, false);
  assert.equal(getSplitPeriodBoundaryRepair({start_date:'2026-10-17',end_date:'2026-10-17'}, '2026-11-01').needsRepair, false);
  assert.equal(getSplitPeriodBoundaryRepair({start_date:'2026-10-01',end_date:'2026-10-17'}, '2026-10-28').needsRepair, false);
});
