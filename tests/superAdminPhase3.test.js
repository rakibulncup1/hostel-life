import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

test('Super Admin Phase 3 exposes health, notice monitoring and reports tabs', () => {
  const page = read('src/features/platform/SuperAdminPage.jsx');
  for (const label of ['System Health', 'নোটিশ পর্যবেক্ষণ', 'রিপোর্ট এক্সপোর্ট']) assert.ok(page.includes(label));
  assert.ok(page.includes('platformAdminGetSystemHealth'));
  assert.ok(page.includes('platformAdminListNoticeMonitoring'));
  assert.ok(page.includes('platformAdminGetPlatformReport'));
  assert.ok(page.includes('downloadPlatformReport'));
});

test('Phase 3 service calls use Super Admin RPC endpoints with bounded request arguments', () => {
  const service = read('src/services/platformService.js');
  for (const rpc of ['platform_admin_get_system_health', 'platform_admin_list_notice_monitoring', 'platform_admin_get_platform_report']) assert.ok(service.includes(`'${rpc}'`));
  assert.ok(service.includes('Math.min(100, Math.max(1, Number(limit) || 25))'));
});

test('Run26 enforces signed-in Super Admin checks on every new endpoint', () => {
  const sql = read('supabase/migrations/Run26_super_admin_phase3_tools.sql');
  assert.equal((sql.match(/PERFORM private\.assert_signed_in\(\);/g) || []).length, 3);
  assert.equal((sql.match(/IF NOT private\.is_super_admin\(\) THEN/g) || []).length, 3);
  assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.platform_admin_get_system_health'));
  assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.platform_admin_list_notice_monitoring'));
  assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.platform_admin_get_platform_report'));
});

test('Run26 aggregate report bounds date range and excludes personal member rows', () => {
  const sql = read('supabase/migrations/Run26_super_admin_phase3_tools.sql');
  assert.ok(sql.includes('p_to_date-p_from_date>366'));
  assert.ok(sql.includes('daily_meal_records'));
  assert.ok(sql.includes('market_entries'));
  assert.ok(sql.includes('ledger_transactions'));
  assert.ok(!sql.includes("'member_id'"));
  assert.ok(!sql.includes("'member_name'"));
});

test('Run26 notice monitor reads global and hostel-level notices without sending or modifying notices', () => {
  const sql = read('supabase/migrations/Run26_super_admin_phase3_tools.sql');
  assert.ok(sql.includes('public.platform_settings'));
  assert.ok(sql.includes('public.hostel_pinned_announcements'));
  assert.ok(sql.includes('platform_admin_list_notice_monitoring'));
  assert.ok(!sql.includes('DELETE FROM public.hostel_pinned_announcements'));
  assert.ok(!sql.includes('INSERT INTO public.notifications'));
});

test('Run26 archived snapshot aggregation uses the JSONB item alias consistently', () => {
  const sql = read('supabase/migrations/Run26_super_admin_phase3_tools.sql');
  assert.ok(sql.includes('AS ledger_rows(item)'));
  assert.ok(sql.includes("(item->>'amount')::numeric"));
  assert.ok(!sql.includes("(x->>'amount')::numeric"));
});

test('Run26 does not create tables, alter schema, or write/delete application data', () => {
  const sql = read('supabase/migrations/Run26_super_admin_phase3_tools.sql');
  assert.doesNotMatch(sql, /\bCREATE\s+TABLE\b/i);
  assert.doesNotMatch(sql, /\bALTER\s+TABLE\b/i);
  assert.doesNotMatch(sql, /\bINSERT\s+INTO\s+public\./i);
  assert.doesNotMatch(sql, /\bUPDATE\s+public\./i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\s+public\./i);
});
