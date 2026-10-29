import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const ui = readFileSync(new URL('../src/features/menu/MenuPages.jsx', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261029_khala_recipient_history_fix.sql', import.meta.url), 'utf8');
test('public khala history distinguishes recipient and creator', () => {
  assert.match(ui, /যাঁর নামে: \{row\.member_name/);
  assert.match(ui, /এন্ট্রি করেছেন: \{row\.created_by_name/);
});
test('khala history RPC reads recipient membership from stored record', () => {
  assert.match(migration, /'member_id', k\.member_id/);
  assert.match(migration, /hm\.id = k\.member_id/);
});
