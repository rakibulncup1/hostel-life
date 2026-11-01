import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlatformOverview } from '../src/utils/platformOverview.js';

test('reads all metrics exposed by the platform overview RPC', () => {
  const result = normalizePlatformOverview({
    hostel_count: 4, active_hostel_count: 3, member_count: 17,
    inactive_member_count: 2, blocked_user_count: 1, suspended_hostel_count: 1,
    user_count: 19, recent_hostels: 2, super_admin_count: 1,
  });
  assert.equal(result.hostels, 4);
  assert.equal(result.activeHostels, 3);
  assert.equal(result.users, 19);
  assert.equal(result.activeMemberships, 17);
  assert.equal(result.inactiveMemberships, 2);
  assert.equal(result.blockedUsers, 1);
  assert.equal(result.suspendedHostels, 1);
  assert.equal(result.recentHostels, 2);
  assert.equal(result.superAdmins, 1);
});

test('unknown metrics remain unknown rather than falsely displaying zero', () => {
  const result = normalizePlatformOverview({ hostel_count: 2 });
  assert.equal(result.users, null);
  assert.equal(result.inactiveMemberships, null);
  assert.equal(result.recentHostels, null);
});

test('retains support for older overview response names', () => {
  const result = normalizePlatformOverview({ hostels: 3, active_memberships: 9 });
  assert.equal(result.hostels, 3);
  assert.equal(result.activeMemberships, 9);
});
