import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const page = read('src/features/platform/SuperAdminPage.jsx');
const service = read('src/services/platformService.js');

test('Super Admin overview refresh keeps independent successful sections when one RPC fails', () => {
  assert.match(page, /Promise\.allSettled\(\[\s*platformAdminGetOverview\(\),\s*platformAdminListHostels\(\),\s*fetchPlatformPublicSettings\(\{ force: true \}\)/);
  assert.match(page, /কিছু Super Admin তথ্য লোড হয়নি; সফল তথ্যগুলো ব্যবহার করা যাবে/);
});

test('Super Admin audit, activity, security, codes, health, notices and reports ignore stale responses', () => {
  for (const ref of ['auditRequestRef', 'activityRequestRef', 'securityRequestRef', 'codeHistoryRequestRef', 'healthRequestRef', 'noticeMonitorRequestRef', 'reportRequestRef']) {
    assert.match(page, new RegExp(`const requestId = \\+\\+${ref}\\.current`), `${ref} must issue a monotonically increasing request id`);
    assert.match(page, new RegExp(`requestId (?:!==|===) ${ref}\\.current`), `${ref} must ignore stale results`);
  }
});

test('Security summary and event list load independently instead of hiding both on one RPC failure', () => {
  assert.match(page, /const results = await Promise\.allSettled\(\[\s*platformAdminGetSecurityOverviewV2\(\),[\s\S]*?platformAdminListSecurityEventsV2/);
  assert.match(page, /Security Summary:/);
  assert.match(page, /Security Event List:/);
});

test('Activity filter exposes every defined table/archive/platform action label', () => {
  assert.match(page, /Object\.entries\(ACTIVITY_EVENT_LABELS\)/);
  assert.match(page, /Object\.entries\(ARCHIVE_ACTIVITY_LABELS\)/);
  assert.match(page, /Object\.entries\(AUDIT_ACTION_LABELS\)/);
  assert.doesNotMatch(page, /<option value="meal_request\.insert">/);
});

test('Member session history errors are displayed separately from member activity errors', () => {
  assert.match(page, /const \[memberSessionError, setMemberSessionError\] = useState\(''\)/);
  assert.match(page, /setMemberSessionError\(errorText\(cause, 'Login History/);
  assert.match(page, /\{memberSessionError && <div className="inline-error platform-alert">\{memberSessionError\}<\/div>\}/);
});

test('Hostel-scoped member RPC is the sole source for the complete member card identity fields', () => {
  assert.match(service, /platform_admin_list_hostel_members_v3/);
  assert.match(service, /Run27's hostel-scoped RPC already returns email\/avatar for every member/);
  assert.doesNotMatch(service, /hl_b_platform_member_directory/);
  const sql = read('supabase/migrations/Run27_activity_presence_security_monitoring.sql');
  assert.match(sql, /'avatar_url',p\.avatar_url/);
  assert.match(sql, /'email',\(SELECT u\.email FROM auth\.users u WHERE u\.id=m\.user_id\)/);
});

test('Backup Assistant download link resolves to a packaged local asset', () => {
  const asset = path.join(root, 'public/downloads/Hostel_Life_Backup_Assistant_Windows_Package.zip');
  assert.ok(fs.existsSync(asset), 'Backup Assistant ZIP must exist in public/downloads');
  assert.match(page, /href="\/downloads\/Hostel_Life_Backup_Assistant_Windows_Package\.zip"/);
});
