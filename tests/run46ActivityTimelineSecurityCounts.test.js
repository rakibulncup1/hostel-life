import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/Run46_activity_timeline_security_counts_and_ip_only.sql');
const verify = read('supabase/verify/Verify_Run46_activity_timeline_security_counts.sql');
const diagnostic = read('supabase/diagnostics/Activity_Event_Repeat_Audit_READ_ONLY.sql');
const page = read('src/features/platform/SuperAdminPage.jsx');
const css = read('src/styles/platform-admin-final-polish.css');
const service = read('src/services/platformService.js');
const run9 = read('supabase/migrations/Run9.sql');
const run1 = read('supabase/migrations/Run1.sql');
const run38 = read('supabase/migrations/Run38_security_monitor_actor_identity.sql');

test('Run46 suppresses calendar-seed activity noise without altering meal calendar rows', () => {
  assert.match(migration, /TG_TABLE_NAME='daily_meal_days' AND TG_OP='INSERT' THEN RETURN NEW/);
  assert.match(run9, /ON CONFLICT \(period_id, meal_date\) DO NOTHING/i);
  assert.match(run1, /unique\(period_id,meal_date\)/i);
  assert.match(migration, /hostel_life\.suppress_activity_capture/);
  assert.match(migration, /meal_day\.auto_finalized/);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+private\.hl_activity_events/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.daily_meal_(days|records)/i);
});

test('Automatic finalization suppresses row-level noise and restores the prior flag on errors', () => {
  assert.match(migration, /set_config\('hostel_life\.suppress_activity_capture', 'on', true\)/);
  assert.match(migration, /exception when others then[\s\S]*?set_config\('hostel_life\.suppress_activity_capture', v_previous_capture_setting, true\)[\s\S]*?raise;/i);
  assert.match(migration, /finalized_day_count/);
  assert.match(migration, /finalized_meal_record_count/);
  assert.match(migration, /source','auto_cutoff'/);
  assert.match(migration, /archive_period_audit/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.close_current_month/);
  assert.match(migration, /meal_day\.period_closed/);
  assert.match(migration, /Month close updates many meal rows[\s\S]*?set_config\('hostel_life\.suppress_activity_capture', 'on', true\)/);
});

test('Security telemetry clears geo metadata only and preserves IP and security state', () => {
  for (const table of ['hl_security_events', 'hl_security_ip_blocks', 'hl_password_reset_ip_attempts']) {
    assert.match(migration, new RegExp(`UPDATE private\\.${table}[\\s\\S]*?SET country_code=NULL,city=NULL,region=NULL,region_code=NULL`, 'i'));
  }
  assert.match(migration, /IP addresses, event timestamps, fingerprints, failure codes, block scopes\/reasons,/i);
  assert.match(migration, /CREATE OR REPLACE FUNCTION private\.hl_enforce_ip_only_security_metadata/);
  assert.match(migration, /CREATE TRIGGER hl_enforce_ip_only_geo BEFORE INSERT OR UPDATE ON private\.%I/);
  assert.doesNotMatch(migration, /DROP\s+COLUMN|DROP\s+TABLE|TRUNCATE|DELETE\s+FROM\s+private\.hl_security/i);
});

test('Security one-minute and 15-minute counters are rolling windows and remain server-derived', () => {
  assert.match(run38, /'ip_attempts_1m'[\s\S]*?interval '1 minute'/);
  assert.match(run38, /'ip_attempts_15m'[\s\S]*?interval '15 minutes'/);
  assert.match(service, /platform_admin_list_security_events_v4/);
  assert.match(page, /সর্বশেষ ৬০ সেকেন্ডে/);
  assert.match(page, /সর্বশেষ ১৫ মিনিটে/);
  assert.match(page, /Number\(row\.ip_attempts_1m\|\|0\)/);
  assert.match(page, /৬০ সেকেন্ডের হিসাবটি সর্বশেষ এক মিনিটের চলমান গণনা/);
});

test('The Activity Timeline labels the new compact finalization summary', () => {
  assert.match(page, /meal_day\.auto_finalized/);
  assert.match(page, /মিলের দিনগুলো স্বয়ংক্রিয়ভাবে চূড়ান্ত/);
});

test('Desktop email reveal control is inside the email field; mobile rules are untouched', () => {
  assert.match(css, /@media \(min-width: 621px\)[\s\S]*?platform-reauth-email-field > input[\s\S]*?padding-right: 54px !important/);
  assert.match(css, /platform-reauth-email-field > \.platform-reauth-email-toggle[\s\S]*?position: absolute !important[\s\S]*?right: 6px !important[\s\S]*?left: auto !important/);
  assert.match(css, /@media \(max-width: 620px\)/);
});

test('Run46 verification and duplicate diagnostic remain read-only', () => {
  assert.match(verify, /read-only post-deployment verification/i);
  assert.doesNotMatch(verify, /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/im);
  assert.match(diagnostic, /unique period date|unique key/i);
  assert.match(diagnostic, /HAVING count\(\*\)>1/);
  assert.match(diagnostic, /activity_capture_trigger_count/);
  assert.match(diagnostic, /private\.hl_capture_activity_event/);
  assert.doesNotMatch(diagnostic, /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/im);
});
