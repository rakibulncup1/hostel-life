import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRunningPeriodPayload, resolveDashboardPeriodStatus, dashboardNeedsPeriodFallback, reconcileManagementContextWithPeriod } from '../src/utils/period.js';

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

test('hides the open-ended running-period sentinel and retains real closed dates', () => {
  const running = normalizeRunningPeriodPayload({ period: {
    id: 'running-open-ended', status: 'running', start_date: '2026-10-17', end_date: '9999-12-31',
  } });
  assert.equal(running.end_date, null);
  assert.equal(running.start_date, '2026-10-17');

  const closed = normalizeRunningPeriodPayload({ period: {
    id: 'closed-period', status: 'closed', start_date: '2026-10-17', end_date: '2026-10-27',
  } });
  assert.equal(closed.end_date, '2026-10-27');
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


test('recovers the running period when management context falsely omits it', () => {
  const result = reconcileManagementContextWithPeriod(
    { has_running_period: false, period: null, next_required_start_date: '2026-10-13' },
    { period: { id: 'new-period', label: 'October 2026', status: 'running' }, has_running_period: true },
    { verificationSucceeded: true, today: '2026-10-13', canManageMonth: true },
  );
  assert.equal(result.has_running_period, true);
  assert.equal(result.period.period_id, 'new-period');
  assert.equal(result.next_required_start_date, '2026-10-13');
  assert.equal(result.can_manage_month, true);
});

test('reports no running month only after a successful empty canonical lookup', () => {
  const result = reconcileManagementContextWithPeriod(
    { has_running_period: false, period: null }, null,
    { verificationSucceeded: true, today: '2026-10-13' },
  );
  assert.equal(result.has_running_period, false);
  assert.equal(result.period, null);
});

test('keeps month state unknown when canonical verification fails', () => {
  const result = reconcileManagementContextWithPeriod(
    { has_running_period: false, period: null }, null,
    { verificationSucceeded: false, today: '2026-10-13' },
  );
  assert.equal(result.has_running_period, undefined);
  assert.equal(result.period, null);
});
