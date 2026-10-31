import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDhakaCalendarDays,
  canActivateNextPeriod,
  getDhakaDateTimeParts,
  getMemberDeactivationImpact,
  getNextPeriodActivationMessage,
} from '../src/utils/monthLifecyclePolicy.js';

const dhakaInstant = (dateTime) => new Date(dateTime);

test('Dhaka date/time conversion uses Bangladesh calendar time', () => {
  const parts = getDhakaDateTimeParts(dhakaInstant('2026-10-31T14:00:00.000Z'));
  assert.equal(parts.today, '2026-10-31');
  assert.equal(parts.hour, '20');
  assert.equal(parts.minute, '00');
  assert.equal(parts.minutes, 20 * 60);
});

test('calendar-day arithmetic works across month and year boundaries', () => {
  assert.equal(addDhakaCalendarDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDhakaCalendarDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDhakaCalendarDays('bad-date', 1), '');
});

test('next-day period cannot open one second before 8 PM Dhaka', () => {
  assert.equal(
    canActivateNextPeriod('2026-11-01', dhakaInstant('2026-10-31T13:59:59.000Z')),
    false,
  );
});

test('next-day period can open from exactly 8 PM Dhaka', () => {
  assert.equal(
    canActivateNextPeriod('2026-11-01', dhakaInstant('2026-10-31T14:00:00.000Z')),
    true,
  );
});

test('delayed activation remains possible on or after the first meal date', () => {
  assert.equal(
    canActivateNextPeriod('2026-11-01', dhakaInstant('2026-11-01T01:00:00.000Z')),
    true,
  );
  assert.equal(
    canActivateNextPeriod('2026-10-31', dhakaInstant('2026-10-31T01:00:00.000Z')),
    true,
  );
});

test('a period more than one day in the future cannot be opened early', () => {
  assert.equal(
    canActivateNextPeriod('2026-11-02', dhakaInstant('2026-10-31T14:00:00.000Z')),
    false,
  );
});

test('activation message explains the 8 PM wait before the opening window', () => {
  const message = getNextPeriodActivationMessage(
    '2026-11-01',
    dhakaInstant('2026-10-31T13:59:00.000Z'),
  );
  assert.match(message, /রাত ৮টার পর/);
});

test('activation message preserves the 10 PM normal request deadline', () => {
  const message = getNextPeriodActivationMessage(
    '2026-11-01',
    dhakaInstant('2026-10-31T14:30:00.000Z'),
  );
  assert.match(message, /রাত ১০টা পর্যন্ত/);
});

test('delayed opening on first meal date directs users to Late Request before 9 PM', () => {
  const message = getNextPeriodActivationMessage(
    '2026-10-31',
    dhakaInstant('2026-10-31T13:00:00.000Z'),
  );
  assert.match(message, /Late Request/);
  assert.match(message, /রাত ৯টার আগে/);
});

test('deactivation before 9 PM cancels today and future meal data', () => {
  const impact = getMemberDeactivationImpact(
    dhakaInstant('2026-10-31T14:59:59.000Z'),
    '2026-10-01',
  );
  assert.equal(impact.rule, 'cancel');
  assert.equal(impact.beforeFinalization, true);
});

test('deactivation at exactly 9 PM preserves today and cancels future meal data', () => {
  const impact = getMemberDeactivationImpact(
    dhakaInstant('2026-10-31T15:00:00.000Z'),
    '2026-10-01',
  );
  assert.equal(impact.rule, 'preserve');
  assert.equal(impact.beforeFinalization, false);
});

test('future-start period reports that the member has no current-period meal day yet', () => {
  const impact = getMemberDeactivationImpact(
    dhakaInstant('2026-10-31T14:00:00.000Z'),
    '2026-11-01',
  );
  assert.equal(impact.rule, 'not_in_period');
});
