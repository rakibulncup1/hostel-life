import test from 'node:test';
import assert from 'node:assert/strict';
import { getHistoryDayBadge } from '../src/utils/periodMessaging.js';

test('history badge marks today using Bangladesh business date', () => {
  assert.deepEqual(getHistoryDayBadge('2026-11-13', '2026-11-13'), { label: 'আজ', tone: 'today' });
});

test('history badge marks yesterday', () => {
  assert.deepEqual(getHistoryDayBadge('2026-11-12', '2026-11-13'), { label: 'গতকাল', tone: 'yesterday' });
});

test('history badge handles month and year boundaries', () => {
  assert.deepEqual(getHistoryDayBadge('2026-12-31', '2027-01-01'), { label: 'গতকাল', tone: 'yesterday' });
  assert.deepEqual(getHistoryDayBadge('2024-02-28', '2024-02-29'), { label: 'গতকাল', tone: 'yesterday' });
});

test('history badge does not label older dates', () => {
  assert.equal(getHistoryDayBadge('2026-11-11', '2026-11-13'), null);
});

test('history badge rejects malformed dates', () => {
  assert.equal(getHistoryDayBadge('not-a-date', '2026-11-13'), null);
  assert.equal(getHistoryDayBadge('2026-11-13', 'invalid'), null);
  assert.equal(getHistoryDayBadge('', '2026-11-13'), null);
});
