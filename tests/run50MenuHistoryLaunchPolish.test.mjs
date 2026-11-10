import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveLaunchPath, APP_BACKGROUND_EXIT_KEY } from '../src/app/appLaunchPolicy.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('cold launch after a background exit sends app routes to dashboard only', () => {
  assert.equal(resolveLaunchPath('/app/dining', true), '/app/dashboard');
  assert.equal(resolveLaunchPath('/app/menu/archive', true), '/app/dashboard');
  assert.equal(resolveLaunchPath('/app/dining', false), '/app/dining');
  assert.equal(resolveLaunchPath('/auth/login', true), '/auth/login');
  assert.equal(resolveLaunchPath('/invite/abc', true), '/invite/abc');
  assert.equal(APP_BACKGROUND_EXIT_KEY, 'hostel-life-background-exit-v1');
});

test('menu uses the Bengali closed-months label and keeps Khala Money separated for managers', () => {
  const menu = read('src/components/MenuDrawer.jsx');
  assert.match(menu, /key: 'archive', label: 'বন্ধ মাসসমূহ'/);
  assert.match(menu, /key: 'khala-money-view', label: 'খালার টাকা'/);
  assert.match(menu, /commonItems\.filter\(\(item\) => !\(effectiveOperationalManager && item\.key === 'khala-money-view'\)\)/);
  assert.match(menu, /\{effectiveOperationalManager && \(/);
  assert.match(menu, /const primaryItems = \[/);
});

test('archive month badges derive editability from server permission results', () => {
  const archive = read('src/features/archive/ArchiveCorrectionPage.jsx');
  assert.match(archive, /fetchMyArchiveEditablePeriods\(\)/);
  assert.match(archive, /can_edit: Boolean\(primary \|\| editableIds\.has\(key\)\)/);
  assert.match(archive, /row\.can_edit \? .*সম্পাদনার অনুমতি/s);
  assert.match(archive, /শুধু দেখা · লক/);
  assert.match(archive, /<h1>বন্ধ মাসসমূহ<\/h1>/);
});


test('archive route access recognizes both the closing manager and a valid archive edit grant', () => {
  const context = read('src/hooks/useManagementContext.js');
  const app = read('src/app/App.jsx');
  assert.match(context, /\['closed_by', 'archive_grant'\]\.includes\(period\?\.access_kind\)/);
  assert.match(app, /pathname === '\/app\/menu\/archive'.*isManager \|\| hasClosedMonthAccess/);
  assert.match(context, /get_khala_entry_periods_v2/);
});

test('member and manager Khala pages expose month tabs and only show edit form for authorized period', () => {
  const menuPages = read('src/features/menu/MenuPages.jsx');
  const managerPages = read('src/features/manager/ManagerPages.jsx');
  for (const text of ['পূর্ববর্তী মাস', 'বর্তমান মাস', 'সকল মাস']) {
    assert.ok(menuPages.includes(text), `member Khala page missing ${text}`);
    assert.ok(managerPages.includes(text), `manager Khala page missing ${text}`);
  }
  assert.match(menuPages, /can_manage_khala: editableIds\.has/);
  assert.match(managerPages, /selectedPeriod\?\.can_manage_khala && <form/);
  assert.match(managerPages, /if \(!selectedPeriod\.can_manage_khala\)/);
  assert.match(managerPages, /এই মাসের হিসাব দেখা যাবে, তবে এন্ট্রি বা সংশোধনের অনুমতি নেই/);
});

test('ordinary member market-entry hint is removed while manager and period warnings remain', () => {
  const dining = read('src/features/dining/DiningPage.jsx');
  assert.match(dining, /\{\(isManager \|\| periodNotStarted\) && \(/);
  assert.match(dining, /periodNotStarted \? periodStartNotice : 'বাজারকারীর নাম/);
  assert.match(dining, /manager-request-review-guide" icon="clipboard-check"/);
  assert.doesNotMatch(dining, /manager-request-review-guide" icon="inbox"/);
});

test('market edit rows use stable keys instead of item-name-dependent keys', () => {
  const history = read('src/features/history/HistoryPage.jsx');
  assert.match(history, /rowKey: item\.id \|\| item\.entry_item_id \|\| `existing-\$\{index\}`/);
  assert.match(history, /key=\{item\.rowKey\}/);
  assert.doesNotMatch(history, /key=\{`\$\{index\}-\$\{item\.item_name\}`\}/);
});

test('market share output trims leading whitespace before every numbered item', () => {
  const share = read('src/utils/marketShare.js');
  assert.match(share, /return `\$\{formatNumber\(index \+ 1[\s\S]*?replace\(\/\^\[\\s\\u00a0\]\+\//);
});

test('history and archive detail views receive responsive guidance and detail styling', () => {
  const menuPages = read('src/features/menu/MenuPages.jsx');
  const history = read('src/features/history/HistoryPage.jsx');
  const css = read('src/styles/run50-ui-finish.css');
  assert.match(menuPages, /closed-month-guidance-panel/);
  assert.match(menuPages, /document-guidance-panel/);
  assert.match(history, /history-month-detail-modal/);
  assert.match(css, /\.history-month-detail-modal \.archive-detail-grid/);
  assert.match(css, /\.closed-month-guidance-panel,[\s\S]*?\.document-guidance-panel/);
});

test('market history modal retains shared market presentation class', () => {
  const history = read('src/features/history/HistoryPage.jsx');
  const share = read('src/utils/marketShare.js');
  assert.match(history, /শর্ট শেয়ার/);
  assert.match(share, /export function buildMarketShareText/);
});

test('desktop auth brand panel adds product cues without changing the form flow', () => {
  const auth = read('src/features/auth/AuthPage.jsx');
  const css = read('src/styles/run50-ui-finish.css');
  assert.match(auth, /auth-brand-feature-list/);
  assert.match(auth, /মিল, বাজার ও হিসাব—এক জায়গায়/);
  assert.match(css, /\.auth-brand-feature-list/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*?\.auth-brand-feature-list \{ display: none; \}/);
});

test('the app records cold background exit but does not persist sensitive form data', () => {
  const app = read('src/app/App.jsx');
  const policy = read('src/app/appLaunchPolicy.js');
  assert.match(app, /localStorage\.setItem\(APP_BACKGROUND_EXIT_KEY/);
  assert.match(app, /resolveLaunchPath\(currentPath, markerPresent\)/);
  assert.match(policy, /safePath\.startsWith\('\/app\/'\)/);
  assert.doesNotMatch(app, /localStorage\.setItem\([^\n]*(password|otp|payment|amount)/i);
});
