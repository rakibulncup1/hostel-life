import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRunningPeriodPayload, resolveDashboardPeriodStatus, dashboardNeedsPeriodFallback } from '../src/utils/period.js';

test('normalizes canonical nested running-period context', () => {
  const result = normalizeRunningPeriodPayload({
    period: { id: 'period-1', label: 'October', status: 'running' },
    has_running_period: true,
  });
  assert.equal(result.period_id, 'period-1');
  assert.equal(result.label, 'October');
});

test('supports older direct period payload and JSON encoded payload', () => {
  assert.equal(normalizeRunningPeriodPayload({ id: 'period-2' }).period_id, 'period-2');
  assert.equal(normalizeRunningPeriodPayload(JSON.stringify({ period: { period_id: 'period-3' } })).period_id, 'period-3');
});

test('returns null for a successful empty context rather than inventing a month', () => {
  assert.equal(normalizeRunningPeriodPayload({ period: null, has_running_period: false }), null);
  assert.equal(normalizeRunningPeriodPayload(null), null);
  assert.equal(normalizeRunningPeriodPayload('{bad-json'), null);
});


test('keeps previously verified current month when dashboard RPC returns a stale false flag', () => {
  assert.equal(dashboardNeedsPeriodFallback({ has_running_period: false }), true);
  assert.equal(resolveDashboardPeriodStatus({
    periodWasResolved: false,
    data: { has_running_period: false },
    previous: { has_running_period: true, period_status: 'running', period: { id: 'running-period' } },
  }), 'running');
});

test('uses canonical period lookup as authority when it was successfully checked', () => {
  assert.equal(resolveDashboardPeriodStatus({
    periodWasResolved: true, periodResultStatus: 'fulfilled', resolvedPeriod: { id: 'running-period' },
    data: { has_running_period: false }, previous: { has_running_period: false },
  }), 'running');
  assert.equal(resolveDashboardPeriodStatus({
    periodWasResolved: true, periodResultStatus: 'fulfilled', resolvedPeriod: null,
    data: { has_running_period: true }, previous: { has_running_period: true },
  }), 'none');
});


test('does not label a failed first period lookup as no-month', () => {
  assert.equal(resolveDashboardPeriodStatus({
    periodWasResolved: true, periodResultStatus: 'rejected',
    data: { has_running_period: false }, previous: null,
  }), 'unknown');
});


test('does not trust a legacy cached false when canonical lookup fails', () => {
  assert.equal(resolveDashboardPeriodStatus({
    periodWasResolved: true, periodResultStatus: 'rejected',
    data: { has_running_period: false }, previous: { has_running_period: false },
  }), 'unknown');
});
