import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const main = read('src/main.jsx');
const history = read('src/features/history/HistoryPage.jsx');
const manager = read('src/features/manager/ManagerPages.jsx');
const menu = read('src/features/menu/MenuPages.jsx');
const archive = read('src/features/archive/ArchiveCorrectionPage.jsx');
const dashboardCss = read('src/styles/dashboard-reimagined-original.css');
const polish = read('src/styles/finishing-polish-v15.css');

test('v15 finishing stylesheet is loaded after the accepted visual layers', () => {
  assert.match(main, /styles\/finishing-polish-v15\.css/);
  assert.ok(main.indexOf('styles/menu-interior-experience-v14.css') < main.indexOf('styles/finishing-polish-v15.css'));
});

test('History day badges are derived from Bangladesh business date without a service call', () => {
  assert.match(history, /getHistoryDayBadge\(row\.entry_date\)/);
  assert.match(history, /getHistoryDayBadge\(row\.entry_date \|\| row\.created_at\)/);
  assert.match(read('src/utils/periodMessaging.js'), /export function getHistoryDayBadge/);
  const badgeHelper = read('src/utils/periodMessaging.js').match(/export function getHistoryDayBadge\([\s\S]*?\n}\n/)?.[0] || '';
  assert.ok(badgeHelper);
  assert.doesNotMatch(badgeHelper, /fetch|supabase|rpc/i);
});

test('Khala amount and entry count use the already loaded selected-period rows', () => {
  assert.match(manager, /const effectiveVisibleRows = visibleRows\.filter\(\(row\) => row\.status !== 'void'\)/);
  assert.match(manager, /formatNumber\(effectiveVisibleRows\.length\)\}টি কার্যকর এন্ট্রি/);
  assert.doesNotMatch(manager, /fetchKhalaEntryCount|khala_entry_count/i);
});

test('redundant one-line policy and ranking text is removed', () => {
  assert.doesNotMatch(menu, /policy-public-full-link/);
  assert.doesNotMatch(menu, /মোট বাজারের ভিত্তিতে তালিকা; বাজারকারী ও এন্ট্রিকারী আলাদা হতে পারেন/);
  assert.doesNotMatch(manager, /PDF তৈরির আগে নির্বাচিত মাস ও হিসাবের সারসংক্ষেপ যাচাই করুন/);
  assert.doesNotMatch(manager, /চূড়ান্ত মিল ও সদস্যভিত্তিক হিসাব দেখুন/);
});

test('closed-month reopen conditions are consolidated in the access summary', () => {
  assert.doesNotMatch(archive, /archive-reopen-hint/);
  assert.match(archive, /পুনরায় চালুর সুযোগ শুধু সর্বশেষ বন্ধ মাসে/);
  assert.match(polish, /archive-hero-guidance p[\s\S]*font-weight: 500/);
});

test('How-to timing cards lose the decorative stripe and FAQ intro becomes a panel', () => {
  assert.match(polish, /howto-time-card::before[\s\S]*content: none !important/);
  assert.match(polish, /howto-faq-intro[\s\S]*border-radius: 15px/);
});

test('all app modals lock document scroll and contain internal scrolling', () => {
  assert.match(polish, /html:has\(body \[aria-modal="true"\]\)/);
  assert.match(polish, /body:has\(\[aria-modal="true"\]\)/);
  assert.match(polish, /overscroll-behavior: contain/);
});

test('dashboard primary cards share equal desktop tracks and account balance has breathing room', () => {
  assert.match(polish, /dashboard-primary-grid\.has-late-request[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(polish, /my-account-card \.account-grid \{ margin-bottom: 9px; \}/);
  assert.match(polish, /member-period-detail-modal > \.modal-head[\s\S]*border-radius: 16px/);
});

test('pinned desktop theme switcher is hidden while profile remains theme selector', () => {
  assert.match(polish, /\.desktop-theme-bar \{ display: none !important; \}/);
  assert.match(read('src/features/profile/ProfilePage.jsx'), /profile-theme-choice-grid/);
});

test('History mobile refresh and export controls split the available width equally', () => {
  assert.match(polish, /history-title-actions\.has-export-action[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test('mobile market serial aligns as a text prefix inside the item-name field', () => {
  assert.match(polish, /market-item-name-field \.market-input-item[\s\S]*padding-left: 27px/);
  assert.match(polish, /market-item-index[\s\S]*background: transparent !important/);
});

