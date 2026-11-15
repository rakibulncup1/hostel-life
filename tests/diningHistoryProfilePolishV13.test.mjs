import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const dining = read('src/features/dining/DiningPage.jsx');
const history = read('src/features/history/HistoryPage.jsx');
const profile = read('src/features/profile/ProfilePage.jsx');
const main = read('src/main.jsx');
const diningCss = read('src/styles/dining-finish-v13.css');
const historyCss = read('src/styles/history-finish-v13.css');
const profileCss = read('src/styles/profile-finish-v13.css');

test('request-history day cards render all three meal values in a bounded read-only grid', () => {
  assert.match(dining, /compact && readOnly \? \([\s\S]*?meal-day-readonly-grid/);
  assert.match(dining, /\['breakfast', 'ব্রেকফাস্ট'\][\s\S]*?\['lunch', 'লাঞ্চ'\][\s\S]*?\['dinner', 'ডিনার'\]/);
  assert.match(diningCss, /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(diningCss, /min-width:\s*0/);
  assert.match(diningCss, /@media \(max-width: 390px\)/);
});

test('manager self-meal tile is explicitly labelled as a general member feature', () => {
  const ownMealLines = dining.split('\n').filter((line) => line.includes('title="আমার মিল"'));
  assert.ok(ownMealLines.length >= 2);
  assert.ok(ownMealLines.every((line) => line.includes('badge="সাধারণ"')));
  assert.match(dining, /typeof badge === 'string' \? badge : 'ম্যানেজার'/);
  assert.match(diningCss, /\.dining-access-badge\.is-general/);
});

test('admin-entry choices use distinct colors with explicit dark-theme surfaces', () => {
  assert.match(dining, /admin-entry-choice-grid/);
  assert.match(diningCss, /admin-entry-choice-grid > \.request-choice-card:first-child[\s\S]*?background/);
  assert.match(diningCss, /admin-entry-choice-grid > \.request-choice-card:nth-child\(2\)[\s\S]*?background/);
  assert.match(diningCss, /:root\[data-theme="dark"\][\s\S]*?admin-entry-choice-grid/);
});

test('request landing summary and action cards preserve icon-left layout and theme-aware contrast', () => {
  assert.match(dining, /PersonalTomorrowMealCard/);
  assert.match(dining, /request-choice-new/);
  assert.match(dining, /request-choice-history/);
  assert.match(dining, /request-choice-late/);
  assert.match(diningCss, /personal-tomorrow-head h2/);
  assert.match(diningCss, /request-choice-card small[\s\S]*?color: #596d80/);
  assert.match(diningCss, /:root\[data-theme="dark"\][\s\S]*?request-choice-card small/);
});

test('History removes the redundant page-level edit instruction but keeps selected-archive access context', () => {
  assert.doesNotMatch(history, /history-intro-guidance-box|সম্পাদনা শুধু যে অ্যাকাউন্ট মাসটি বন্ধ করেছে, সেই অ্যাকাউন্টের জন্য/);
  assert.match(history, /archive-scope-note is-readonly/);
  assert.match(history, /সম্পাদনা শুধু যিনি মাসটি বন্ধ করেছেন তিনিই করতে পারবেন/);
});

test('market cards are clickable as a whole, show item count in the buyer row and retain the total', () => {
  assert.match(history, /<button className=\{`card history-item-card history-market-entry-card[\s\S]*?onClick=\{\(\) => onOpen\(row\.market_entry_id\)\}/);
  assert.match(history, /history-market-title-row[\s\S]*?row\.buyer_name[\s\S]*?history-market-item-count[\s\S]*?history-market-serial/);
  assert.doesNotMatch(history, /history-market-bottom-row|history-row-open-hint/);
  assert.match(history, /মোট বাজার[\s\S]*?formatCurrency\(row\.total_amount\)/);
  assert.match(historyCss, /\.history-market-title-row[\s\S]*?grid-template-columns/);
  assert.match(historyCss, /\.history-market-amount[\s\S]*?background:/);
});

test('account history, market details and archived summaries use the shared History color system', () => {
  assert.match(historyCss, /account-summary-card\.positive/);
  assert.match(historyCss, /account-summary-card\.market/);
  assert.match(historyCss, /account-summary-card\.negative/);
  assert.match(historyCss, /history-final-summary-list/);
  assert.match(historyCss, /market-detail-summary/);
  assert.match(historyCss, /detail-total-bar/);
  assert.match(historyCss, /:root\[data-theme="blue"\]/);
  assert.match(historyCss, /:root\[data-theme="dark"\]/);
});

test('previous-month retention facts stay compact and keep the values already fetched by the page', () => {
  assert.match(history, /history-retention-summary/);
  assert.match(history, /retentionNotice\.detail_months/);
  assert.match(history, /retentionNotice\.summary_months/);
  assert.doesNotMatch(history, /history-retention-policy/);
});

test('Profile role reflects the already-loaded operational role without adding a new request', () => {
  assert.match(profile, /useAuth\(\)/);
  assert.match(profile, /operationalRole\?\.is_primary_manager/);
  assert.match(profile, /operationalRole\?\.is_assistant_manager/);
  assert.match(profile, /'সহকারী ম্যানেজার'/);
  assert.match(profile, /আমার ভূমিকা/);
  assert.doesNotMatch(profile, /supabase\.rpc|get_my_operational_role/);
});

test('Profile cards and role badge use Dashboard-aligned theme colors including dark surfaces', () => {
  assert.match(profile, /profile-role-line/);
  assert.match(profileCss, /profile-personal-section/);
  assert.match(profileCss, /profile-security-section/);
  assert.match(profileCss, /profile-hostel-section/);
  assert.match(profileCss, /profile-theme-section/);
  assert.match(profileCss, /member-badge\.assistant/);
  assert.match(profileCss, /:root\[data-theme="blue"\]/);
  assert.match(profileCss, /:root\[data-theme="dark"\]/);
});

test('the three feature stylesheets are loaded after prior UI layers', () => {
  const diningImport = main.indexOf("styles/dining-finish-v13.css");
  const historyImport = main.indexOf("styles/history-finish-v13.css");
  const profileImport = main.indexOf("styles/profile-finish-v13.css");
  assert.ok(diningImport >= 0 && historyImport > diningImport && profileImport > historyImport);
});
