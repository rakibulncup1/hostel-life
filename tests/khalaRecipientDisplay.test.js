import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('../src/features/menu/MenuPages.jsx', import.meta.url), 'utf8');
const previousMigration = readFileSync(new URL('../supabase/migrations/20261029_khala_recipient_history_fix.sql', import.meta.url), 'utf8');
const currentMigration = readFileSync(new URL('../supabase/migrations/Run20_khala_recipient_history.sql', import.meta.url), 'utf8');

test('public khala history prominently distinguishes recipient and creator', () => {
  assert.match(ui, /<span>যাঁর নামে নথিভুক্ত<\/span>\s*<strong>\{row\.member_name/);
  assert.match(ui, /পরিশোধ করেছেন: \{row\.created_by_name/);
});

test('earlier recipient history repair joins the recipient membership', () => {
  assert.match(previousMigration, /'member_id', k\.member_id/);
  assert.match(previousMigration, /hm\.id = k\.member_id/);
});

test('Run20 restores the correct history RPC after later overwrites and also uses the stored snapshot', () => {
  assert.match(currentMigration, /'member_id', k\.member_id/);
  assert.match(currentMigration, /k\.member_name_snapshot/);
  assert.match(currentMigration, /LEFT JOIN public\.hostel_memberships recipient_membership/);
  assert.match(currentMigration, /LEFT JOIN public\.profiles recipient_profile/);
});
