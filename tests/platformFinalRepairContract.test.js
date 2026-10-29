import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('realtime beacon skips cascading-delete rows whose parent period/hostel is missing', () => {
  const sql = read('supabase/migrations/20261029_platform_admin_final_repair.sql');
  assert.match(sql, /CREATE OR REPLACE FUNCTION private\.bump_realtime_beacon\(\)/);
  assert.match(sql, /NOT EXISTS\s*\(\s*SELECT 1 FROM public\.hostels/);
  assert.match(sql, /NOT EXISTS\s*\(\s*SELECT 1 FROM public\.monthly_periods/);
  assert.match(sql, /current_setting\('hostel_lifecycle\.deleting_hostel', true\)/);
  assert.match(sql, /set_config\('hostel_lifecycle\.deleting_hostel', p_hostel_id::text, true\)/);
  assert.ok(sql.indexOf('DELETE FROM public.monthly_periods WHERE hostel_id') < sql.indexOf('DELETE FROM public.hostels WHERE id'));
  assert.match(sql, /hl_period_summary_snapshots/);
  assert.doesNotMatch(sql, /DELETE FROM auth\.users/);
  assert.match(sql, /FUNCTION public\.platform_admin_list_closed_periods/);
  assert.match(sql, /FUNCTION public\.platform_admin_permanently_delete_member/);
  assert.match(sql, /DELETE FROM public\.hostel_memberships WHERE id = v_member\.id/);
  assert.doesNotMatch(sql, /DELETE FROM auth\.users/);
});

test('temporary password function has safe non-mutating health-check and detailed request IDs', () => {
  const code = read('supabase/functions/admin-temporary-password/index.ts');
  assert.match(code, /body\.action === 'healthcheck'/);
  assert.match(code, /must_change_password: true/);
  assert.match(code, /AUTH_PASSWORD_UPDATE_FAILED/);
  assert.match(code, /request_id: requestId/);
  assert.doesNotMatch(code, /console\.(log|error)\([^\n]*(secret|temporary_password)/i);
});

test('Auth orphan scan checks multiple pages and gives scan progress', () => {
  const code = read('supabase/functions/admin-delete-unlinked-user/index.ts');
  assert.match(code, /AUTH_PAGES_PER_BATCH = 10/);
  assert.match(code, /listUsers\(\{ page: authPage, perPage: AUTH_PAGE_SIZE \}\)/);
  assert.match(code, /scanned_users: scannedUsers\.length/);
  assert.match(code, /has_more: !reachedEnd/);
  assert.match(code, /users.length < AUTH_PAGE_SIZE \|\| authPage >= 1000/);
  assert.match(code, /linkedIds\.has\(user\.id\)/);
  assert.match(code, /protectedSuperAdminIds\.has\(user\.id\)/);
});

test('Super Admin UI exposes health-check and does not say a 50-user page is the entire directory', () => {
  const ui = read('src/features/platform/SuperAdminPage.jsx');
  assert.match(ui, /Function সংযোগ পরীক্ষা/);
  assert.match(ui, /edgeInvokeErrorText\(invokeError\)/);
  assert.match(ui, /সর্বোচ্চ ৫০০টি Auth account/);
  assert.match(ui, /orphanScanInfo\.scannedUsers/);
  assert.match(ui, /platformAdminPermanentlyDeleteMember\(selected\.hostel_id, member\.membership_id, false, confirmation\)/);
});
