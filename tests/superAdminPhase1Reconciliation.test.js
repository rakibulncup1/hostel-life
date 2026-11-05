import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const page = read('src/features/platform/SuperAdminPage.jsx');
const service = read('src/services/platformService.js');
const migration = read('supabase/migrations/Run34_super_admin_runtime_health_and_audit_readability.sql');
const selector = read('src/components/SearchableSelect.jsx');
const styles = read('src/styles/super-admin-experience.css');

test('all Overview statistics have a working click-through destination', () => {
  const overview = page.slice(page.indexOf("{tab === 'overview'"), page.indexOf("{tab === 'insights'"));
  const stats = [...overview.matchAll(/<Stat\b[\s\S]*?\/>/g)].map((match) => match[0]);
  assert.ok(stats.length >= 9, 'expected all platform overview metrics');
  for (const stat of stats) assert.match(stat, /onClick=\{/);
  for (const target of ['health','reports','audit','activity','backup','sessions']) {
    assert.ok(overview.includes(`['${target}',`), `missing quick access for ${target}`);
  }
});

test('database runtime health is read-only and explicitly excludes unavailable billing quotas', () => {
  assert.match(service, /platform_admin_get_database_runtime_health/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.platform_admin_get_database_runtime_health\(\)/);
  assert.match(migration, /PERFORM private\.assert_signed_in\(\)/);
  assert.match(migration, /IF NOT private\.is_super_admin\(\) THEN/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.platform_admin_get_database_runtime_health\(\) FROM PUBLIC,anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.platform_admin_get_database_runtime_health\(\) TO authenticated/);
  assert.match(migration, /pg_database_size/);
  assert.match(migration, /pg_stat_activity/);
  assert.match(migration, /pg_locks/);
  assert.match(migration, /pg_stat_database/);
  assert.match(migration, /statistics_reset_at/);
  assert.match(migration, /plan_quota_available',false/);
  assert.doesNotMatch(migration, /\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE)\b/i);
  assert.doesNotMatch(migration, /storage\.objects|storage\.buckets|Logo For Hostel Life/i);
});

test('audit RPC preserves original parameters and returns readable target labels', () => {
  assert.match(migration, /platform_admin_list_audit_logs\([\s\S]*?p_limit integer DEFAULT 25,[\s\S]*?p_offset integer DEFAULT 0,[\s\S]*?p_action text DEFAULT NULL,[\s\S]*?p_target_type text DEFAULT NULL,[\s\S]*?p_search text DEFAULT NULL/);
  assert.match(migration, /'target_label',r\.target_label/);
  assert.match(migration, /'actor_name',COALESCE/);
  assert.match(migration, /'reason',NULLIF/);
  assert.match(migration, /r\.target_label/);
  assert.match(page, /row\.target_label \|\| row\.target_id/);
});

test('searchable hostel selector supports text filtering and keyboard dismissal', () => {
  assert.match(selector, /role="listbox"/);
  assert.match(selector, /role="option"/);
  assert.match(selector, /type="search"/);
  assert.match(selector, /event\.key === 'Escape'/);
  assert.match(selector, /aria-expanded=\{open\}/);
  assert.match(styles, /\.sa-searchable-select-popover/);
  assert.match(styles, /\.sa-searchable-select-options/);
});

test('report export offers CSV and safe aggregate JSON without member-level records', () => {
  assert.match(page, /downloadPlatformReportJson/);
  assert.match(page, /hostel-life-platform-aggregate/);
  assert.match(page, /ব্যক্তিগত লেনদেন অন্তর্ভুক্ত নয়/);
  assert.match(page, /JSON ডাউনলোড/);
  assert.match(page, /Committed Transaction/);
  assert.match(page, /Rolled Back Transaction/);
  assert.match(page, /CSV ডাউনলোড/);
});

test('Backup & Recovery explains test restore and manual recovery boundaries', () => {
  assert.match(page, /SAFE RECOVERY SEQUENCE/);
  assert.match(page, /নতুন\/খালি Target Project/);
  assert.match(page, /Test Project-এ Restore পরীক্ষা/);
  assert.match(page, /Active Session Restore হয় না/);
  assert.match(page, /Auth Provider\/SMTP/);
  assert.match(styles, /\.platform-backup-runbook/);
});

test('Access Code tab no longer includes the long Security Rules explainer', () => {
  const codeTab = page.slice(page.indexOf("{tab === 'security'"), page.indexOf("{tab === 'sessions'"));
  assert.doesNotMatch(codeTab, /Security Rules|নিরাপত্তা নিয়মাবলি/);
});
