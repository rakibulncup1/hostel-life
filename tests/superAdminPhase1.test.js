import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const sql = read('supabase/migrations/Run24_super_admin_observability.sql');
const page = read('src/features/platform/SuperAdminPage.jsx');
const service = read('src/services/platformService.js');

test('Overview UI uses actual RPC metrics and does not invent a soft-delete count', () => {
  const normalizer = read('src/utils/platformOverview.js');
  assert.match(normalizer, /inactive_member_count/);
  assert.match(normalizer, /recent_hostels/);
  assert.match(normalizer, /super_admin_count/);
  assert.match(normalizer, /user_count/);
  assert.match(sql, /'user_count', \(SELECT count\(\*\) FROM auth\.users\)/);
  assert.doesNotMatch(page, /আগে বন্ধ করা মেস/);
  assert.match(page, /নিষ্ক্রিয় মেম্বারশিপ/);
});

test('Audit Log UI is paginated, filterable and uses a dedicated admin RPC', () => {
  assert.match(page, /\['audit','Audit Log'\]/);
  assert.match(page, /platformAdminListAuditLogs/);
  assert.match(page, /auditActionFilter/);
  assert.match(page, /auditTargetFilter/);
  assert.match(page, /auditPage \* pageSize/);
  assert.match(service, /platform_admin_list_audit_logs/);
});

test('Audit RPC is super-admin-only, bounded and returns only allowlisted detail keys', () => {
  assert.match(sql, /FUNCTION public\.platform_admin_list_audit_logs\([\s\S]*?p_limit integer DEFAULT 25[\s\S]*?p_search text DEFAULT NULL\s*\)/);
  assert.match(sql, /IF NOT private\.is_super_admin\(\) THEN[\s\S]*?Audit Log দেখতে পারবেন/);
  assert.match(sql, /LEAST\(GREATEST\(COALESCE\(p_limit,25\),1\),100\)/);
  assert.match(sql, /'details',jsonb_strip_nulls\(jsonb_build_object\(/);
  assert.doesNotMatch(sql, /'email'\s*,\s*a\.details|'phone'\s*,\s*a\.details|'code_hash'\s*,\s*a\.details/);
});

test('Security Code History never returns plaintext codes or code hashes', () => {
  assert.match(page, /Access Code History/);
  assert.match(page, /platformAdminListAccessCodeHistory/);
  assert.match(sql, /FUNCTION public\.platform_admin_list_access_code_history\(/);
  assert.match(sql, /'status',CASE[\s\S]*?WHEN c\.revoked_at IS NOT NULL THEN 'revoked'[\s\S]*?WHEN c\.expires_at <= now\(\) THEN 'expired'[\s\S]*?WHEN c\.use_count >= c\.max_uses THEN 'exhausted'/);
  assert.doesNotMatch(sql, /SELECT[\s\S]{0,500}c\.code_hash/);
  assert.match(sql, /'created_by_name'/);
});

test('favorite/trusted flag changes are appended to the platform audit log', () => {
  assert.match(sql, /'hostel_flag_changed','hostel'/);
  assert.match(sql, /'user_flag_changed','user'/);
  assert.match(sql, /IF v_previous IS DISTINCT FROM v_enabled THEN[\s\S]*?INSERT INTO public\.platform_audit_log/);
});

test('new RPCs revoke public/anon execution and grant authenticated execution only', () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.platform_admin_list_audit_logs\(integer,integer,text,text,text\) FROM PUBLIC, anon/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.platform_admin_list_access_code_history\(integer,integer,text\) FROM PUBLIC, anon/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.platform_admin_list_audit_logs\(integer,integer,text,text,text\) TO authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.platform_admin_list_access_code_history\(integer,integer,text\) TO authenticated/);
});


test('archive summary save and verification are included in platform audit history', () => {
  assert.match(sql, /'archive_summary_saved','monthly_periods'/);
  assert.match(sql, /'archive_summary_verified','monthly_periods'/);
  assert.match(page, /archive_summary_saved: 'আর্কাইভ সামারি সংরক্ষণ'/);
  assert.match(page, /archive_summary_verified: 'আর্কাইভ সামারি যাচাই'/);
});


test('Run24 is additive-only: no table, column, row deletion or data cleanup statements', () => {
  assert.doesNotMatch(sql, /\bCREATE\s+TABLE\b/i);
  assert.doesNotMatch(sql, /\bALTER\s+TABLE\b/i);
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS platform_audit_log_action_created_idx/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS platform_access_codes_history_idx/);
});
