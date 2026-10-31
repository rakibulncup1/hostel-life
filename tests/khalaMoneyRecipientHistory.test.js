import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/Run20_khala_recipient_history.sql', import.meta.url), 'utf8');
const managerPage = await readFile(new URL('../src/features/manager/ManagerPages.jsx', import.meta.url), 'utf8');
const menuPage = await readFile(new URL('../src/features/menu/MenuPages.jsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles/ui-refresh.css', import.meta.url), 'utf8');

 test('Run20 history RPC returns member identity from snapshot or the linked profile', () => {
  assert.match(migration, /'member_id',\s*k\.member_id/);
  assert.match(migration, /'member_name',\s*COALESCE\(/);
  assert.match(migration, /k\.member_name_snapshot/);
  assert.match(migration, /LEFT JOIN public\.hostel_memberships recipient_membership/);
  assert.match(migration, /LEFT JOIN public\.profiles recipient_profile/);
  assert.match(migration, /'recipient_name'/);
});

test('Run20 snapshots the selected member name for future entries through the existing trigger', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION private\.hl_preserve_khala_recipient\(\)/);
  assert.match(migration, /current_setting\('hl\.khala_recipient_member_id', true\)/);
  assert.match(migration, /NEW\.member_id := v_member_id/);
  assert.match(migration, /NEW\.member_name_snapshot := v_member_name/);
  assert.match(migration, /hl_preserve_khala_recipient_on_insert/);
});

test('Run20 preserves the authenticated RPC boundary and does not bulk rewrite history', () => {
  assert.match(migration, /private\.assert_signed_in\(\)/);
  assert.match(migration, /private\.can_access_hostel\(v_hostel\) IS NOT TRUE/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_khala_money_history_v2\(uuid,integer\) FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_khala_money_history_v2\(uuid,integer\) TO authenticated/);
  assert.doesNotMatch(migration, /\bUPDATE\s+public\.khala_money_entries\b/i);
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\s+public\.khala_money_entries\b/i);
  assert.doesNotMatch(migration, /\bDROP\s+(TABLE|FUNCTION)\b/i);
});

test('manager and shared Khala history both emphasize the selected recipient', () => {
  assert.match(managerPage, /className="khala-ledger-recipient"/);
  assert.match(managerPage, /row\.member_name && row\.member_name !== 'খালার পারিশ্রমিক'/);
  assert.match(menuPage, /className="khala-public-person-copy"/);
  assert.match(menuPage, /row\.member_name && row\.member_name !== 'খালার পারিশ্রমিক'/);
  assert.match(styles, /\.khala-ledger-recipient > strong/);
  assert.match(styles, /\.khala-public-person-copy \.khala-ledger-recipient > strong/);
});
