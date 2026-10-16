/**
 * The shipped PostgreSQL platform_admin_get_overview() JSON contract uses
 * *_count fields. Older UI builds used different keys and rendered zero for
 * missing values, making a populated database look empty.
 * Unknown metrics stay null (never synthesize a zero).
 */
export function normalizePlatformOverview(payload) {
  const value = Array.isArray(payload) ? payload[0] || {} : payload || {};
  const numberFrom = (...keys) => {
    for (const key of keys) {
      if (value[key] !== undefined && value[key] !== null && value[key] !== '') {
        const numeric = Number(value[key]);
        return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
      }
    }
    return null;
  };
  return {
    hostels: numberFrom('hostel_count', 'hostels'),
    activeHostels: numberFrom('active_hostel_count', 'active_hostels'),
    users: numberFrom('user_count', 'users'),
    activeMemberships: numberFrom('member_count', 'active_memberships'),
    suspendedHostels: numberFrom('suspended_hostel_count', 'suspended_hostels'),
    softDeletedHostels: numberFrom('soft_deleted_hostel_count', 'soft_deleted_hostels'),
    blockedUsers: numberFrom('blocked_user_count', 'blocked_users'),
  };
}
