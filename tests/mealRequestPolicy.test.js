import test from 'node:test';
import assert from 'node:assert/strict';
import { findActiveMealRequestForDate, getLateMealRequestTargetDate } from '../src/utils/mealRequestPolicy.js';

test('late request targets the current Dhaka date before the 9 PM freeze', () => {
  // 14:59 UTC = 20:59 in Dhaka.
  assert.equal(getLateMealRequestTargetDate(new Date('2026-10-14T14:59:00.000Z')), '2026-10-14');
});

test('late request is closed during the 9–10 PM transition window', () => {
  assert.equal(getLateMealRequestTargetDate(new Date('2026-10-14T15:00:00.000Z')), null);
  assert.equal(getLateMealRequestTargetDate(new Date('2026-10-14T15:59:00.000Z')), null);
});

test('after 10 PM Dhaka, late request targets tomorrow', () => {
  // 16:00 UTC = 22:00 in Dhaka.
  assert.equal(getLateMealRequestTargetDate(new Date('2026-10-14T16:00:00.000Z')), '2026-10-15');
});

test('late-request duplicate precheck detects any active request for the same date', () => {
  const rows = [
    { request_id: 'rejected', status: 'rejected', days: [{ meal_date: '2026-10-15' }] },
    { request_id: 'normal', status: 'approved', request_type: 'normal', is_late_request: false, days: [{ meal_date: '2026-10-15' }] },
  ];
  assert.equal(findActiveMealRequestForDate(rows, '2026-10-15')?.request_id, 'normal');
  assert.equal(findActiveMealRequestForDate(rows, '2026-10-16'), null);
});
