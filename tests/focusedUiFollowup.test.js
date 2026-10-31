import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const menu = read('../src/features/menu/MenuPages.jsx');
const platform = read('../src/features/platform/SuperAdminPage.jsx');
const history = read('../src/features/history/HistoryPage.jsx');
const styles = read('../src/styles/ui-refresh.css');

test('ranking page consumes the existing RPC field names and uses stable fallback ranks', () => {
  assert.match(menu, /row\.rank_no\s*\?\?\s*row\.rank\s*\?\?\s*index\s*\+\s*1/);
  assert.match(menu, /row\.total_market_amount\s*\?\?\s*row\.total_market\s*\?\?\s*row\.amount/);
  assert.match(menu, /row\.total_meals\s*\?\?\s*row\.meals/);
  assert.match(menu, /formatNumber\(safeRank, \{ maximumFractionDigits: 0 \}\)/);
});

test('hostel Auth deletion checkbox is available only after member list is loaded', () => {
  assert.match(platform, /checked=\{Boolean\(deleteAccounts\)\}/);
  assert.match(platform, /disabled=\{busy \|\| \(!member && memberListLoadedHostelId !== selected\.hostel_id\)\}/);
  assert.match(platform, /setMemberListLoadedHostelId\(hostel\.hostel_id\)/);
  assert.doesNotMatch(platform, /const deleteMemberAccounts = false/);
});

test('hostel Auth cleanup happens after database delete through the existing guarded Edge Function', () => {
  const dbDelete = platform.indexOf('await platformAdminPermanentlyDeleteHostel(selected.hostel_id, false, confirmation)');
  const edgeCleanup = platform.indexOf("supabase.functions.invoke('admin-delete-unlinked-user'", dbDelete);
  assert.ok(dbDelete >= 0, 'hostel deletion RPC should preserve Auth by default');
  assert.ok(edgeCleanup > dbDelete, 'Auth cleanup must happen only after the hostel RPC succeeds');
  assert.match(platform, /body: \{ user_id: userId, confirmation: expected \}/);
  assert.match(platform, /new Set\(members\.map\(\(member\) => String\(member\?\.user_id/);
});

test('history retention notice uses only the already-loaded policy values', () => {
  assert.match(history, /history-retention-policy/);
  assert.match(history, /retentionNotice\.detail_months/);
  assert.match(history, /retentionNotice\.summary_months/);
});

test('desktop history, dining mobile heading, rank badges and checkbox styling are scoped', () => {
  assert.match(styles, /@media \(min-width: 851px\)[\s\S]*?\.history-intro-info[\s\S]*?min-height: 40px/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.dining-stack > \.dining-section-title/);
  assert.match(styles, /\.ranking-card \.rank-number\.rank-1/);
  assert.match(styles, /\.ranking-card \.rank-number\.rank-2/);
  assert.match(styles, /\.ranking-card \.rank-number\.rank-3/);
  assert.match(styles, /\.platform-delete-auth-toggle input\[type="checkbox"\]/);
});
