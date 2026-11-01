import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const dining = read('src/features/dining/DiningPage.jsx');
const drawer = read('src/components/MenuDrawer.jsx');
const managerPages = read('src/features/manager/ManagerPages.jsx');
const help = read('src/features/menu/MenuPages.jsx');
const migration = read('supabase/migrations/Run22_assistant_manager_operations.sql');
const run8 = read('supabase/migrations/Run8.sql');

test('finalized-day direct entry is available to primary manager and assigned running-period assistant', () => {
  assert.match(dining, /const canManageFinalMeals = Boolean\(isPrimaryDiningManager \|\| \(hasRunningManagerPeriod && isAssistantManager\)\)/);
  assert.match(dining, /disabled=\{!canManageFinalMeals\} onClick=\{\(\) => setView\('manager-meal'\)\}/);
  assert.match(dining, /<ManagerMealEntry members=\{members\} onSaved=\{loadMembers\} canManageFinalMeals=\{canManageFinalMeals\} \/>/);
  assert.match(dining, /dayStatus\.status !== 'finalized'/);
  assert.match(dining, /date < period\.start_date \|\| date > todayValue\(\)/);
});

test('assistant drawer menu includes hostel settings without exposing primary-only month controls', () => {
  const assistantItems = drawer.match(/const assistantItems = \[([\s\S]*?)\];/)?.[1] || '';
  assert.match(assistantItems, /key: 'hostel-settings'/);
  assert.doesNotMatch(assistantItems, /key: 'new-month'|key: 'current-month-close'|key: 'change-manager'/);
});

test('hostel settings screen accepts operational managers but remains guarded', () => {
  const page = managerPages.slice(managerPages.indexOf('export function HostelSettingsPage()'), managerPages.indexOf('export function MemberManagementPage()'));
  assert.match(page, /<ManagerGuard>/);
  assert.doesNotMatch(page, /<PrimaryManagerGuard>/);
  assert.match(managerPages, /function ManagerGuard\(\{ children \}\)[\s\S]*?isManager \|\| isOperationalManager/);
});

test('Run22 grants final meal entry only after verifying exact running-period manager assignment', () => {
  const fn = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.manager_set_meal_entries'), migration.indexOf('$function$;') + '$function$;'.length);
  assert.match(fn, /PERFORM private\.assert_signed_in\(\)/);
  assert.match(fn, /PERFORM private\.assert_hostel_manager\(v_hostel, v_period\.id, false, false\)/);
  assert.ok(fn.indexOf('v_period.id, false, false') > fn.indexOf('SELECT \* INTO v_period'));
  assert.doesNotMatch(fn, /assert_hostel_manager\(v_hostel, NULL, true, false\)/);
  assert.match(fn, /v_day\.status <> 'finalized'/);
  assert.match(fn, /v_date >= \(now\(\) AT TIME ZONE 'Asia\/Dhaka'\)::date/);
});

test('Run22 opens only the two existing hostel settings RPCs to active operational managers', () => {
  const renameFn = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.manager_update_hostel'), migration.indexOf('$run22$;', migration.indexOf('CREATE OR REPLACE FUNCTION public.manager_update_hostel')) + '$run22$;'.length);
  const joinFn = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.regenerate_join_code'), migration.indexOf('$run22$;', migration.indexOf('CREATE OR REPLACE FUNCTION public.regenerate_join_code')) + '$run22$;'.length);
  assert.match(renameFn, /assert_hostel_manager\(v_hostel, NULL, false, false\)/);
  assert.match(joinFn, /assert_hostel_manager\(v_hostel, NULL, false, false\)/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.manager_set_meal_entries\(jsonb\) FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.manager_set_meal_entries\(jsonb\) TO authenticated/);
  assert.match(migration, /to_regprocedure\('private\.is_assistant_manager\(uuid,uuid\)'\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_my_membership\(\)[\s\S]*?a\.membership_id = m\.id[\s\S]*?THEN h\.join_code/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_my_membership\(\) TO authenticated/);
});

test('archive correction remains primary-manager-only and help explains the new assistant permissions', () => {
  assert.match(run8, /IF NOT private\.is_primary_manager\(v_h,NULL\) THEN RAISE EXCEPTION 'শুধু বর্তমান প্রধান ম্যানেজার'/);
  assert.match(help, /সহকারী ম্যানেজার কি ফাইনাল মিল যোগ বা সংশোধন করতে পারবেন/);
  assert.match(help, /মেস সেটিংস কে ব্যবহার করতে পারবেন/);
  assert.match(help, /Run22 অনুমতি-আপডেট Migration/);
});
