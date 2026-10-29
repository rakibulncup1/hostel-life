import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findActiveMealRequestForDate,
  getLateMealRequestTargetDate,
  isNormalMealRequestWindowOpen,
  isCorrectionWindowForMealDate,
  canDirectEditMealDate,
} from '../src/utils/mealRequestPolicy.js';

test('normal requests remain open before 10 PM Dhaka time', () => {
  assert.equal(isNormalMealRequestWindowOpen(new Date('2026-10-14T15:59:00.000Z')), true); // 21:59 Dhaka
});

test('normal requests close at exactly 10 PM Dhaka time', () => {
  assert.equal(isNormalMealRequestWindowOpen(new Date('2026-10-14T16:00:00.000Z')), false); // 22:00 Dhaka
  assert.equal(isNormalMealRequestWindowOpen(new Date('2026-10-14T16:30:00.000Z')), false);
});

test('late request stays open from previous night 22:00 through target date before 21:00', () => {
  assert.equal(getLateMealRequestTargetDate(new Date('2026-10-14T16:00:00.000Z')), '2026-10-15');
  assert.equal(getLateMealRequestTargetDate(new Date('2026-10-14T18:00:00.000Z')), '2026-10-15'); // midnight Dhaka
  assert.equal(getLateMealRequestTargetDate(new Date('2026-10-15T14:59:59.000Z')), '2026-10-15'); // 20:59:59 Dhaka
  assert.equal(getLateMealRequestTargetDate(new Date('2026-10-15T15:00:00.000Z')), null); // 21:00 Dhaka
  assert.equal(getLateMealRequestTargetDate(new Date('2026-10-15T15:59:00.000Z')), null); // 21:59 Dhaka
});

test('late request opens at 10 PM and targets tomorrow in Dhaka', () => {
  assert.equal(getLateMealRequestTargetDate(new Date('2026-10-14T16:00:00.000Z')), '2026-10-15');
  assert.equal(getLateMealRequestTargetDate(new Date('2026-10-14T17:30:00.000Z')), '2026-10-15');
});

test('late-request duplicate precheck detects any active request for the same date', () => {
  const rows = [
    { request_id: 'rejected', status: 'rejected', days: [{ meal_date: '2026-10-15' }] },
    { request_id: 'normal', status: 'approved', request_type: 'normal', is_late_request: false, days: [{ meal_date: '2026-10-15' }] },
  ];
  assert.equal(findActiveMealRequestForDate(rows, '2026-10-15')?.request_id, 'normal');
  assert.equal(findActiveMealRequestForDate(rows, '2026-10-16'), null);
});

test('correction applies to the locked upcoming/current day, while later dates remain freely editable', () => {
  const before = new Date('2026-10-14T15:59:00.000Z');
  const after = new Date('2026-10-14T16:00:00.000Z');
  const morning = new Date('2026-10-15T03:00:00.000Z');
  const final = new Date('2026-10-15T15:00:00.000Z');
  assert.equal(canDirectEditMealDate('2026-10-15', before), true);
  assert.equal(canDirectEditMealDate('2026-10-15', after), false);
  assert.equal(isCorrectionWindowForMealDate('2026-10-15', after), true);
  assert.equal(isCorrectionWindowForMealDate('2026-10-15', morning), true);
  assert.equal(isCorrectionWindowForMealDate('2026-10-15', final), false);
  assert.equal(canDirectEditMealDate('2026-10-16', after), true);
});
