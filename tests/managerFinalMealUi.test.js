import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/features/dining/DiningPage.jsx', import.meta.url), 'utf8');
test('finalized manager entry lists active members, including those with no finalized record', () => {
  assert.match(source, /activeMembers\.filter\(\(member\) => member\.membership_id === selectedMember\) : activeMembers/);
  assert.match(source, /আগে মিল নেই · নতুন এন্ট্রি/);
});
test('past-day entry still requires finalized day and the current running month', () => {
  assert.match(source, /dayStatus\.status !== 'finalized'/);
  assert.match(source, /date < period\.start_date \|\| date > todayValue\(\)/);
});
test('wide desktop content is not restricted to the earlier 1180px canvas', () => {
  const css = readFileSync(new URL('../src/styles/ui-refresh.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(min-width: 1360px\)/);
  assert.match(css, /1760px/);
});
