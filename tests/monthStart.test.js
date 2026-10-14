import test from 'node:test';
import assert from 'node:assert/strict';
import { addIsoDays, deriveNextRequiredStartDate, dhakaDateInputValue, firstDayOfMonth } from '../src/utils/monthStart.js';

test('initial month begins on day one of the current Bangladesh calendar month', () => {
  assert.equal(firstDayOfMonth('2026-10-14'), '2026-10-01');
  assert.equal(deriveNextRequiredStartDate([], '2026-10-14'), '2026-10-01');
});

test('next month begins the day after the latest closed or archived period', () => {
  const periods = [
    { status: 'archived', end_date: '2026-08-31' },
    { status: 'closed', end_date: '2026-09-30' },
    { status: 'running', end_date: '2026-12-31' },
  ];
  assert.equal(deriveNextRequiredStartDate(periods, '2026-10-14'), '2026-10-01');
  assert.equal(deriveNextRequiredStartDate([{ status: 'closed', end_date: '2026-10-10' }], '2026-10-14'), '2026-10-11');
});

test('ignores invalid dates and does not treat a running period as archived history', () => {
  assert.equal(firstDayOfMonth('not-a-date'), '');
  assert.equal(addIsoDays('2026-02-30', 1), '');
  assert.equal(deriveNextRequiredStartDate([{ status: 'running', end_date: '2026-10-20' }], '2026-10-14'), '2026-10-01');
});

test('formats dates in Asia/Dhaka independent of host timezone', () => {
  // 2026-09-30 19:00 UTC is already October 1 in Bangladesh (UTC+6).
  assert.equal(dhakaDateInputValue(new Date('2026-09-30T19:00:00Z')), '2026-10-01');
});
