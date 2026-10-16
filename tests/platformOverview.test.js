import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlatformOverview } from '../src/utils/platformOverview.js';

test('reads real PostgreSQL overview keys, not incompatible frontend names', () => {
  const result = normalizePlatformOverview({ hostel_count: 4, active_hostel_count: 3, member_count: 17, blocked_user_count: 2, suspended_hostel_count: 1 });
  assert.equal(result.hostels, 4);
  assert.equal(result.activeMemberships, 17);
  assert.equal(result.blockedUsers, 2);
  assert.equal(result.suspendedHostels, 1);
});
test('unknown metrics remain unknown rather than falsely displaying zero', () => {
  const result = normalizePlatformOverview({ hostel_count: 2 });
  assert.equal(result.users, null);
  assert.equal(result.softDeletedHostels, null);
});
test('retains support for older overview response names', () => {
  const result = normalizePlatformOverview({ hostels: 3, active_memberships: 9 });
  assert.equal(result.hostels, 3);
  assert.equal(result.activeMemberships, 9);
});
