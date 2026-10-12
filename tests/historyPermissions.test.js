import test from 'node:test';
import assert from 'node:assert/strict';
import { isCurrentPeriodManager } from '../src/utils/historyPermissions.js';

test('recognizes a primary manager even when membership role is not manager', () => {
  assert.equal(isCurrentPeriodManager({
    membership: { id: 'membership-1', status: 'active', role: 'member' },
    period: { period_id: 'period-1', primary_manager_membership_id: 'membership-1' },
  }), true);
});

test('supports legacy membership_id field', () => {
  assert.equal(isCurrentPeriodManager({
    membership: { membership_id: 'membership-2', status: 'active', role: 'member' },
    period: { primary_manager_membership_id: 'membership-2' },
  }), true);
});

test('does not grant current-period management to inactive member', () => {
  assert.equal(isCurrentPeriodManager({
    membership: { id: 'membership-3', status: 'inactive', role: 'manager' },
    period: { primary_manager_membership_id: 'membership-3' },
  }), false);
});

test('recognizes period assistant identity', () => {
  assert.equal(isCurrentPeriodManager({
    membership: { membership_id: 'membership-4', status: 'active', role: 'member' },
    period: { period: { assistant_managers: [{ membership_id: 'membership-4' }] } },
  }), true);
});

test('does not treat archive access as implied by current manager', () => {
  // HistoryPage always requires archiveEditPeriods for an archive_period selection.
  // The pure helper only authorizes the current period context.
  assert.equal(isCurrentPeriodManager({
    membership: { membership_id: 'membership-5', status: 'active', role: 'member' },
    period: { primary_manager_membership_id: 'another-member' },
  }), false);
});
