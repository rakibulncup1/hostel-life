import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const file=(name)=>readFileSync(new URL(`../${name}`,import.meta.url),'utf8');
test('FK snapshot cleanup occurs before deleting hostel inside transaction',()=>{
 const sql=file('supabase/migrations/Run14.sql');
 assert.match(sql,/BEGIN;/);
 assert.match(sql,/DELETE FROM public\.daily_meal_snapshots WHERE hostel_id = \$1/);
 assert.ok(sql.indexOf('DELETE FROM public.daily_meal_snapshots WHERE hostel_id') < sql.indexOf('DELETE FROM public.hostels WHERE id'));
 assert.match(sql,/COMMIT;/);
});
test('Super Admin membership roles are scoped to selected hostel and authorized',()=>{
 const sql=file('supabase/migrations/Run12.sql');
 assert.match(sql,/private\.is_super_admin\(\)/);
 assert.match(sql,/WHERE m\.hostel_id=p_hostel_id/);
 assert.match(sql,/p\.status='running'/);
});
test('actual archive page offers restore when server authorizes',()=>{
 const jsx=file('src/features/archive/ArchiveCorrectionPage.jsx');
 assert.match(jsx,/selected\?\.can_reopen/);
 assert.match(jsx,/reopenArchivedPeriod\(selected\.period_id\)/);
});
test('Auth account deletion checks other memberships before admin API',()=>{
 const ts=file('supabase/functions/admin-delete-unlinked-user/index.ts');
 assert.match(ts,/role !== 'super_admin'/);
 assert.match(ts,/from\('hostel_memberships'\)/);
 assert.ok(ts.indexOf("from('hostel_memberships')") < ts.indexOf('admin.auth.admin.deleteUser(id)'));
});
test('role directory failure does not hide member list',()=>{
 const jsx=file('src/features/platform/SuperAdminPage.jsx');
 assert.match(jsx,/setMembers\(list\);/);
 assert.match(jsx,/setMembers\(list\);[\s\S]*?try \{\s*const roles = await platformAdminListHostelRoleBadges/);
 assert.match(jsx,/ম্যানেজার\/সহকারী পরিচয়ের ব্যাজ লোড হয়নি/);
});
