import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');
const migration = read('supabase/migrations/Run19_member_month_lifecycle_rules.sql');
const managerUi = read('src/features/manager/ManagerPages.jsx');
const diningUi = read('src/features/dining/DiningPage.jsx');

test('migration is a single atomic transaction with schema preflight', () => {
  assert.match(migration, /\nBEGIN;/);
  assert.match(migration.trim(), /COMMIT;$/);
  assert.match(migration, /Required Hostel Life tables are missing; no changes applied/);
  assert.match(migration, /Required Hostel Life security\/finalization helpers are missing; no changes applied/);
});

test('migration uses the requested 8 PM next-day opening threshold', () => {
  assert.match(migration, /v_local_time < TIME '20:00'/);
  assert.match(migration, /v_local_now::time >= TIME '20:00'/);
  assert.match(migration, /NEW.start_date = v_today \+ 1/);
});

test('request trigger serializes against close and validates active membership', () => {
  assert.match(migration, /FROM public\.monthly_periods WHERE id=NEW\.period_id FOR SHARE/);
  assert.match(migration, /status='active'/);
  assert.match(migration, /v_period\.status <> 'running'/);
});

test('member deactivation follows the strict before-9 versus 9-and-after boundary', () => {
  assert.match(migration, /v_local_time < TIME '21:00' THEN v_today ELSE v_today \+ 1 END/);
  assert.match(migration, /today_meal_rule/);
  assert.match(migration, /SET status='inactive',deactivated_at=clock_timestamp\(\),updated_at=clock_timestamp\(\)/);
});

test('month close finalizes immediately and explicitly cancels future requests and records', () => {
  assert.match(migration, /public\.close_current_month\(p_confirm_future_cancel boolean DEFAULT false\)/);
  assert.match(migration, /status='cancelled'/);
  assert.match(migration, /meal_date>v_today/);
  assert.match(migration, /today_finalized_immediately',true/);
});

test('early close applies approved special requests only to days newly finalized by that close', () => {
  assert.match(migration, /v_auto_finalized_days := private\.finalize_due_days\(v_hostel,v_period\.id\)/);
  assert.match(migration, /d\.id=ANY\(v_manual_finalize_day_ids\)/);
  assert.match(migration, /PERFORM private\.apply_request_days_for_finalized_day_ids\(v_request_id,v_manual_finalize_day_ids\)/);
  assert.match(migration, /AND d\.id=ANY\(v_manual_finalize_day_ids\)\s+AND d\.status='finalized' AND NOT r\.cancelled/s);
});

test('close snapshot does not rewrite already-finalized historical day rows', () => {
  const snapshotStart = migration.indexOf('-- Month closure is an explicit early-finalization action.');
  const snapshotEnd = migration.indexOf('UPDATE public.monthly_periods', snapshotStart);
  assert.notEqual(snapshotStart, -1);
  assert.notEqual(snapshotEnd, -1);
  const snapshotBlock = migration.slice(snapshotStart, snapshotEnd);
  assert.match(snapshotBlock, /d\.id=ANY\(v_manual_finalize_day_ids\)/);
  assert.doesNotMatch(snapshotBlock, /d\.meal_date<=v_today/);
});

test('migration does not delete meal request or meal record history', () => {
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.meal_requests/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.daily_meal_records/i);
});

test('manager UI explains month close impact and 8 PM opening rule in Bengali', () => {
  assert.match(managerUi, /বন্ধ করার সঙ্গে সঙ্গেই আজকের হিসাবও চূড়ান্ত হবে/);
  assert.match(managerUi, /রাত ৮টার পর নতুন মাস চালু করা যাবে/);
  assert.match(managerUi, /আগের দিনের চূড়ান্ত হিসাব/);
});

test('manager UI explains the before/after 9 PM deactivation impact', () => {
  assert.match(managerUi, /বাংলাদেশ সময় রাত ৯টার আগে/);
  assert.match(managerUi, /বাংলাদেশ সময় রাত ৯টা বা পরে/);
  assert.match(managerUi, /আজকের চূড়ান্ত মিল অক্ষত থাকবে/);
});

test('meal request UI explains first-day normal and late request windows', () => {
  assert.match(diningUi, /নতুন মাসের প্রথম মিলের দিন/);
  assert.match(diningUi, /আজ রাত ১০টা পর্যন্ত/);
  assert.match(diningUi, /রাত ১০টার সাধারণ অনুরোধের সময় শেষ হয়েছে/);
});


test('migration preserves already-finalized member days during deactivation', () => {
  const start = migration.indexOf('CREATE OR REPLACE FUNCTION public.deactivate_member');
  const end = migration.indexOf('-- Extend the preflight response', start);
  const fn = migration.slice(start, end);
  assert.match(fn, /already_finalized\.status='finalized'/);
  assert.match(fn, /AND d\.status <> 'finalized'/);
  assert.match(fn, /v_local_time < TIME '21:00' THEN v_today ELSE v_today \+ 1 END/);
});

test('month close applies special requests only to newly finalized day IDs', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION private\.apply_request_days_for_finalized_day_ids\(\s*p_request_id uuid,\s*p_day_ids uuid\[\]/);
  assert.match(migration, /PERFORM private\.apply_request_days_for_finalized_day_ids\(v_request_id,v_manual_finalize_day_ids\)/);
  const start = migration.indexOf('CREATE OR REPLACE FUNCTION private.apply_request_days_for_finalized_day_ids');
  const end = migration.indexOf('REVOKE ALL ON FUNCTION private.apply_request_days_for_finalized_day_ids', start);
  const helper = migration.slice(start, end);
  assert.match(helper, /NOT \(v_day\.id=ANY\(p_day_ids\)\)/);
  assert.match(helper, /v_req\.status<>'approved'/);
});

test('close preflight blocks on future financial entries and has one authoritative can_close value', () => {
  const start = migration.indexOf('CREATE OR REPLACE FUNCTION public.get_month_close_preflight');
  const end = migration.indexOf('CREATE OR REPLACE FUNCTION private.apply_request_days_for_finalized_day_ids', start);
  const fn = migration.slice(start, end);
  assert.match(fn, /future_financial_entry_count/);
  assert.match(fn, /'can_close',\(v_future_financial=0\)/);
  assert.equal((fn.match(/'can_close'/g) || []).length, 4); // three early-return cases plus final computed result
});

test('close waits for member/request locks before period FOR UPDATE', () => {
  const start = migration.indexOf('CREATE OR REPLACE FUNCTION public.close_current_month');
  const fn = migration.slice(start, migration.indexOf('COMMIT;', start));
  const memberLock = fn.indexOf('pg_advisory_xact_lock(hashtextextended(v_lock_membership::text, 0))');
  const requestLock = fn.indexOf('FOR UPDATE OF r');
  const periodLock = fn.indexOf('FROM public.monthly_periods\n  WHERE id=v_period.id AND hostel_id=v_hostel AND status=\'running\'\n  FOR UPDATE');
  assert.ok(memberLock >= 0 && requestLock > memberLock && periodLock > requestLock);
});

test('correction and edit RPCs take member advisory lock before locking request rows', () => {
  const correctionStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.create_meal_correction_request');
  const correctionEnd = migration.indexOf('CREATE OR REPLACE FUNCTION public.edit_my_approved_meal_request', correctionStart);
  const correction = migration.slice(correctionStart, correctionEnd);
  assert.ok(correction.indexOf('pg_advisory_xact_lock') < correction.indexOf('FOR UPDATE'));
  const editStart = correctionEnd;
  const editEnd = migration.indexOf('CREATE OR REPLACE FUNCTION public.deactivate_member', editStart);
  const edit = migration.slice(editStart, editEnd);
  assert.ok(edit.indexOf('pg_advisory_xact_lock') < edit.indexOf('FOR UPDATE'));
});

test('manager UI fails closed when close preflight is unavailable', () => {
  assert.match(managerUi, /const preflightKnown = typeof preflight\?\.can_close === 'boolean'/);
  assert.match(managerUi, /const cannotCloseYet = !preflightKnown/);
  assert.match(managerUi, /আবার যাচাই করুন/);
});

test('manager deactivation success notice reports actual cancellation counts', () => {
  assert.match(managerUi, /cancelled_request_count/);
  assert.match(managerUi, /cancelled_meal_record_count/);
  assert.match(managerUi, /মোট \$\{cancelledRequests\}টি অনুরোধ ও \$\{cancelledRecords\}টি মিল রেকর্ড বাতিল হয়েছে/);
});


test('month close pins period end_date to the same Dhaka date used for finalization', () => {
  const start = migration.indexOf('CREATE OR REPLACE FUNCTION public.close_current_month');
  const end = migration.indexOf('COMMIT;', start);
  const fn = migration.slice(start, end);
  assert.match(fn, /SET end_date=v_today,status='closed'/);
  assert.match(migration, /WHEN NEW\.end_date < DATE '9999-12-31' AND NEW\.end_date <= v_today THEN NEW\.end_date/);
});


test('future-start period guard uses valid no-op statements for allowed branches', () => {
  const start = migration.indexOf('CREATE OR REPLACE FUNCTION private.hl_b_guard_period_dates');
  const end = migration.indexOf('-- The request guard', start);
  const fn = migration.slice(start, end);
  assert.match(fn, /AND EXISTS \([\s\S]*?\) THEN\s+NULL;/);
  assert.match(fn, /IS NOT DISTINCT FROM \(to_jsonb\(NEW\) - 'end_date'\) THEN\s+[\s\S]*?NULL;/);
});

test('approved special-request upsert uses a PostgreSQL target-table alias', () => {
  const start = migration.indexOf('CREATE OR REPLACE FUNCTION private.apply_request_days_for_finalized_day_ids');
  const end = migration.indexOf('REVOKE ALL ON FUNCTION private.apply_request_days_for_finalized_day_ids', start);
  const fn = migration.slice(start, end);
  assert.match(fn, /INSERT INTO public\.daily_meal_records AS current_record/);
  assert.match(fn, /current_record\.actual_breakfast/);
  assert.doesNotMatch(fn, /public\.daily_meal_records\.actual_/);
});


test('close preflight does not double-count a pending special request that also contains future dates', () => {
  const start = migration.indexOf('CREATE OR REPLACE FUNCTION public.get_month_close_preflight');
  const end = migration.indexOf('CREATE OR REPLACE FUNCTION private.apply_request_days_for_finalized_day_ids', start);
  const fn = migration.slice(start, end);
  const special = fn.slice(fn.indexOf('SELECT count(*) INTO v_pending_special'));
  assert.match(special, /AND NOT EXISTS \([\s\S]*?meal_date[^\n]*> v_today/);
});

test('deactivation preserves today when the day is already finalized even before 9 PM', () => {
  const start = migration.indexOf('CREATE OR REPLACE FUNCTION public.deactivate_member');
  const end = migration.indexOf('-- Extend the preflight response', start);
  const fn = migration.slice(start, end);
  assert.match(fn, /AND NOT EXISTS \([\s\S]*?already_finalized\.status='finalized'[\s\S]*?\) THEN\s+v_today_rule := 'cancel'/);
  assert.match(fn, /ELSIF v_period\.start_date <= v_today THEN\s+v_today_rule := 'preserve'/);
});


test('migration preflight validates snapshot and request date columns used by replacement RPCs', () => {
  assert.match(migration, /\('meal_requests','start_date'\),\('meal_requests','end_date'\),\('meal_requests','member_name_snapshot'\)/);
  assert.match(migration, /\('daily_meal_records','member_name_snapshot'\)/);
});


test('migration preflight validates correction parent and request origin columns', () => {
  assert.match(migration, /\('meal_requests','parent_request_id'\),\('meal_requests','origin'\)/);
});
