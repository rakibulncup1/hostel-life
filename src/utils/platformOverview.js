/**
 * Normalizes the exact platform_admin_get_overview() JSON contract.
 * Missing metrics remain null rather than being fabricated as zero.
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
    inactiveMemberships: numberFrom('inactive_member_count', 'inactive_memberships'),
    suspendedHostels: numberFrom('suspended_hostel_count', 'suspended_hostels'),
    blockedUsers: numberFrom('blocked_user_count', 'blocked_users'),
    superAdmins: numberFrom('super_admin_count', 'super_admins'),
    recentHostels: numberFrom('recent_hostels', 'recent_hostel_count'),
  };
}
