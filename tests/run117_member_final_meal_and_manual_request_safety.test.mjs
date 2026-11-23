import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isManualNormalRequestCutoffClosedForRange } from '../src/utils/mealRequestPolicy.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('manual normal request closes only when the selected range includes tomorrow after 22:00 Dhaka', () => {
  const beforeCutoff = new Date('2026-11-23T15:59:00.000Z'); // 21:59 Dhaka
  const atCutoff = new Date('2026-11-23T16:00:00.000Z'); // 22:00 Dhaka
  assert.equal(isManualNormalRequestCutoffClosedForRange('2026-11-24', '2026-11-24', beforeCutoff), false);
  assert.equal(isManualNormalRequestCutoffClosedForRange('2026-11-24', '2026-11-24', atCutoff), true);
  assert.equal(isManualNormalRequestCutoffClosedForRange('2026-11-25', '2026-11-25', atCutoff), false);
  assert.equal(isManualNormalRequestCutoffClosedForRange('2026-11-24', '2026-11-26', atCutoff), true);
});

test('manual request form previews conflicts, excludes existing members, and disables submission on failed preflight', async () => {
  const source = await read('src/features/dining/DiningPage.jsx');
  assert.match(source, /fetchMemberMealRequestConflicts\(/);
  assert.match(source, /const eligibleMembers = useMemo/);
  assert.match(source, /memberIds: eligibleMembers\.map\(\(member\) => member\.membership_id\)/);
  assert.match(source, /conflictPreviewLoading \|\| Boolean\(conflictPreviewError\)/);
  assert.match(source, /manual-request-conflict-panel/);
  assert.match(source, /manualNextDayCutoffClosed/);
  assert.match(source, /isManualNormalRequestCutoffClosedForRange\(startDate, endDate, new Date\(\)\)/);
  assert.match(source, /setRequestClock\(new Date\(\)\), 1000/);
});

test('month member meal data now comes from the manager-scoped single-member RPC', async () => {
  const service = await read('src/services/diningService.js');
  assert.match(service, /supabase\.rpc\('manager_get_member_final_meal_month'/);
  assert.doesNotMatch(service, /\.from\('daily_meal_records'\)[\s\S]{0,250}\.eq\('member_id', memberId\)[\s\S]{0,200}\.in\('daily_meal_day_id', dayIds\)/);
});

test('Run96 migration protects member month data and provides read-only duplicate preflight plus server race skipping', async () => {
  const migration = await read('supabase/migrations/Run96_member_final_meal_and_manual_request_conflicts.sql');
  assert.match(migration, /manager_get_member_final_meal_month/);
  assert.match(migration, /private\.assert_hostel_manager\(v_hostel, p_period_id, false, false\)/);
  assert.match(migration, /manager_preview_member_meal_request_conflicts/);
  assert.match(migration, /other\.status IN \('submitted','approved'\)/);
  assert.match(migration, /private\.create_meal_request_internal\(/);
  assert.match(migration, /pg_get_functiondef\(to_regprocedure/);
  assert.match(migration, /installed internal meal-request duplicate contract is not the expected version/);
  assert.match(migration, /WHEN SQLSTATE '23505'/);
  assert.match(migration, /skipped_member_ids/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.manager_preview_member_meal_request_conflicts[\s\S]*?FROM PUBLIC, anon/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.manager_preview_member_meal_request_conflicts[\s\S]*?TO authenticated/i);
  assert.match(migration, /COMMIT;/);
});
