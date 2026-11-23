import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveMemberFinalMealEndDate } from '../src/utils/period.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('open-ended running period displays the elapsed current-month dates through Bangladesh today', () => {
  const period = {
    period_id: 'period-1',
    start_date: '2026-11-01',
    end_date: null, // normalized running-period sentinel
    status: 'running',
  };
  assert.equal(resolveMemberFinalMealEndDate(period, '2026-11-23'), '2026-11-23');
});

test('explicit finite period end date remains authoritative', () => {
  const period = { start_date: '2026-11-01', end_date: '2026-11-30', status: 'running' };
  assert.equal(resolveMemberFinalMealEndDate(period, '2026-11-23'), '2026-11-30');
});

test('raw far-future sentinel also falls back to the supplied Bangladesh date', () => {
  const period = { start_date: '2026-11-01', end_date: '9999-12-31', status: 'running' };
  assert.equal(resolveMemberFinalMealEndDate(period, '2026-11-23'), '2026-11-23');
});

test('invalid or missing Bangladesh date does not manufacture a calendar range', () => {
  assert.equal(resolveMemberFinalMealEndDate({ start_date: '2026-11-01', end_date: null }, ''), null);
  assert.equal(resolveMemberFinalMealEndDate(null, 'not-a-date'), null);
});

test('person-based Final Meal view uses the resolved end date for both data loading and calendar rows', async () => {
  const source = await read('src/features/dining/DiningPage.jsx');
  const start = source.indexOf('const loadMemberMonth = useCallback(async () => {');
  const end = source.indexOf('\n  }, [period, selectedMember]);', start);
  assert.notEqual(start, -1, 'member-month loader exists');
  assert.notEqual(end, -1, 'member-month loader boundary exists');
  const loader = source.slice(start, end);
  assert.match(loader, /resolveMemberFinalMealEndDate\(activePeriod, todayValue\(\)\)/);
  assert.match(loader, /endDate:\s*monthEndDate/);
  assert.match(loader, /buildDateRange\(\s*monthStartDate,\s*monthEndDate/);
  assert.doesNotMatch(loader, /!activePeriod\?\.end_date/);
});
