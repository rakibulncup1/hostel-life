import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
test('hostel delete removes period tree before hostel and never deletes auth in SQL', () => {
  const sql = read('supabase/migrations/20261029_platform_admin_followup_fix.sql');
  assert.ok(sql.indexOf('DELETE FROM public.monthly_periods WHERE hostel_id') < sql.indexOf('DELETE FROM public.hostels WHERE id'));
  assert.ok(sql.indexOf("EXECUTE 'DELETE FROM public.daily_meal_snapshots") < sql.indexOf('DELETE FROM public.hostels WHERE id'));
  assert.doesNotMatch(sql, /DELETE FROM auth\.users/);
  assert.match(sql, /COMMIT;\s*$/);
});
test('separate read-only closed periods from eligibility queue', () => {
  const sql = read('supabase/migrations/20261029_platform_admin_followup_fix.sql');
  assert.match(sql,/FUNCTION public\.platform_admin_list_closed_periods/);
  assert.match(sql,/mp\.status IN \('closed','archived'\)/);
  const ui = read('src/features/platform/SuperAdminPage.jsx');
  assert.match(ui,/সব বন্ধ মাস/);
  assert.match(ui,/ডিলিটের যোগ্যতা/);
});
test('password completion uses one privileged Auth update after caller verification', () => {
  const code = read('supabase/functions/complete-temporary-password/index.ts');
  assert.match(code,/caller\.auth\.getUser\(jwt\)/);
  assert.match(code,/must_change_password/);
  assert.match(code,/admin\.auth\.admin\.updateUserById/);
  assert.doesNotMatch(code,/caller\.auth\.updateUser/);
});
test('orphan directory checks membership and excludes signed-in admin', () => {
  const code = read('supabase/functions/admin-delete-unlinked-user/index.ts');
  assert.match(code,/admin\.auth\.admin\.listUsers/);
  assert.match(code,/linkedIds\.has\(user\.id\)/);
  assert.match(code,/admin\.auth\.admin\.deleteUser/);
});
