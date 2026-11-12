import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Khala page removes redundant instructions and only compacts the intended ledger cards', () => {
  const manager = read('src/features/manager/ManagerPages.jsx');
  const css = read('src/styles/run52-ui-security-polish.css');
  assert.doesNotMatch(manager, /এই খরচটি খালার আলাদা হিসাব হবে/);
  assert.doesNotMatch(manager, /finance-context-note.*সব মাসের হিসাব দেখুন/);
  assert.match(manager, /khala-manager-ledger-row/);
  assert.match(css, /manager-ledger-row\.khala-manager-ledger-row/);
});

test('Telegram privacy note is removed and the menu page always has a return route', () => {
  const telegram = read('src/features/telegram/TelegramConnectionPage.jsx');
  assert.doesNotMatch(telegram, /শুধু অ্যাপ নোটিফিকেশন পাঠানো হয়/);
  assert.match(telegram, /navigateTo\('\/app\/dashboard'\)/);
  assert.match(telegram, /telegram-menu-intro-card/);
  assert.match(telegram, /const pageIntro/);
});

test('Dining capability note remains while the redundant market-entry helper card is removed', () => {
  const dining = read('src/features/dining/DiningPage.jsx');
  assert.match(dining, /!isManager && !isAssistantManager && \(/);
  assert.doesNotMatch(dining, /তারিখ ও বাজারকারীর তথ্য দিয়ে আইটেম যোগ করুন/);
});

test('archive correction UI derives edit access only from the closer permission list', () => {
  const archive = read('src/features/archive/ArchiveCorrectionPage.jsx');
  const context = read('src/hooks/useManagementContext.js');
  assert.match(archive, /can_edit: editableIds\.has\(key\)/);
  assert.match(archive, /const closerAccess = editablePeriods\.some/);
  assert.match(archive, /const canEditSelected = closerAccess/);
  assert.match(archive, /row\?\.access_kind === 'closed_by'/);
  assert.doesNotMatch(archive, /primary \|\| editablePeriods/);
  assert.match(context, /period\?\.access_kind === 'closed_by'/);
  assert.doesNotMatch(context, /archive_grant/);
});

test('history displays a lock note for months not closed by the current account', () => {
  const history = read('src/features/history/HistoryPage.jsx');
  assert.match(history, /সম্পাদনা শুধু যে অ্যাকাউন্ট মাসটি বন্ধ করেছে/);
  assert.match(history, /period\.access_kind === 'closed_by'/);
});

test('menu destination pages have back/title/description headers', () => {
  const telegram = read('src/features/telegram/TelegramConnectionPage.jsx');
  const appDownload = read('src/features/menu/AppDownloadPage.jsx');
  const menu = read('src/features/menu/MenuPages.jsx');
  const css = read('src/styles/run52-ui-security-polish.css');
  assert.match(telegram, /ফিরে যান/);
  assert.match(appDownload, /ফিরে যান/);
  assert.match(menu, /function PageHeader/);
  assert.match(css, /\.menu-page-intro-card/);
});

test('share output removes leading whitespace from every line, preserving one shared formatter', () => {
  const share = read('src/utils/marketShare.js');
  const css = read('src/styles/run52-ui-security-polish.css');
  assert.ok(share.includes('.map((line) => String(line).replace('));
  assert.match(css, /\.market-share-preview[\s\S]*?text-indent: 0 !important/);
});

test('Run43 migration enforces the recorded closer, disables old grants and gates HLC wrappers', () => {
  const sql = read('supabase/migrations/Run43_archive_closer_only_permissions.sql');
  assert.match(sql, /private\.can_manage_closed_period\(p_hostel_id,p_period_id\)/);
  assert.match(sql, /WHEN EXISTS \([\s\S]*?status IN \('closed','archived'\)[\s\S]*?\) THEN private\.can_manage_closed_period/);
  assert.match(sql, /UPDATE public\.archive_edit_permissions[\s\S]*?SET revoked_at/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public\.archive_edit_permissions/);
  assert.match(sql, /RAISE EXCEPTION[\s\S]*?শুধু যিনি মাসটি বন্ধ করেছেন/);
  assert.match(sql, /ALTER FUNCTION public\.hlc_apply_archive_correction/);
  assert.match(sql, /CREATE FUNCTION public\.hlc_apply_archive_correction/);
  assert.doesNotMatch(sql, /DROP POLICY|DROP TABLE|DELETE FROM public\.(market_entries|ledger_transactions|khala_money_entries)/i);
});

test('manager archive screen no longer offers temporary edit grants and gates reopen by recorded closer', () => {
  const manager = read('src/features/manager/ManagerPages.jsx');
  const block = manager.slice(manager.indexOf('export function ArchiveManagerPage()'), manager.indexOf('\nfunction Table({ columns, rows })'));
  assert.match(block, /current_manager_is_closer/);
  assert.match(block, /বন্ধ মাসের সম্পাদনা-নিয়ম/);
  assert.doesNotMatch(block, /grantArchiveEditPermission|fetchArchivePermissions|revokeArchiveEditPermission|অনুমতি দিন/);
  assert.match(block, /selected\?\.can_reopen && isRecordedCloser/);
});

test('market entry no longer renders a redundant helper box', () => {
  const dining = read('src/features/dining/DiningPage.jsx');
  const form = dining.slice(dining.indexOf('function MarketEntryForm'), dining.indexOf('\nfunction ', dining.indexOf('function MarketEntryForm') + 10));
  assert.equal((form.match(/তারিখ ও বাজারকারীর তথ্য দিয়ে আইটেম যোগ করুন/g) || []).length, 0);
  assert.doesNotMatch(form, /<InfoPanel icon="shopping-basket"/);
});

test('archive permission instructions are consistent across History and menu access page', () => {
  const history = read('src/features/history/HistoryPage.jsx');
  const menu = read('src/features/menu/MenuPages.jsx');
  assert.match(history, /সম্পাদনা শুধু যে অ্যাকাউন্ট মাসটি বন্ধ করেছে/);
  assert.match(menu, /আপনি যে মাসগুলো বন্ধ করবেন/);
  assert.doesNotMatch(menu, /বর্তমান প্রধান ম্যানেজার তাকে ওই নির্দিষ্ট মাসের জন্য অস্থায়ী অনুমতি দিতে পারবেন/);
});


test('Run43 SQL preflight requires exact active and unblocked closed_by identity; read-only verifier is supplied', () => {
  const migration = read('supabase/migrations/Run43_archive_closer_only_permissions.sql');
  const verify = read('supabase/verify/Verify_Run43_archive_closer_only_permissions.sql');
  assert.match(migration, /mp\.closed_by=auth\.uid\(\)/);
  assert.match(migration, /m\.status=''active''/);
  assert.match(migration, /notcoalesce\(p\.is_blocked,false\)/);
  assert.match(verify, /active_archive_edit_permission_rows/);
  assert.match(verify, /Direct table write policies/);
});


test('every member opens the same closed-month report page; only edit list controls writes', () => {
  const app = read('src/app/App.jsx');
  assert.match(app, /pathname === '\/app\/menu\/archive'\) return <ArchiveCorrectionPage \/>/);
  assert.match(app, /pathname === '\/app\/menu\/archive-edit-access'\) return <ArchiveCorrectionPage \/>/);
  assert.doesNotMatch(app, /PreviousMonthsPage/);
});

test('member Khala ledger rows are compact without shrinking the amount or status into tiny text', () => {
  const css = read('src/styles/run52-ui-security-polish.css');
  assert.match(css, /\.khala-public-row\s*\{[\s\S]*?padding: 10px 12px/);
  assert.match(css, /\.khala-public-amount > strong\s*\{[\s\S]*?font-size: clamp\(15px/);
  assert.match(css, /\.khala-public-row\.is-mine\s*\{[\s\S]*?padding: 10px 12px/);
});

test('history intro is a responsive, bordered information box and archive hero fills mobile width', () => {
  const css = read('src/styles/run52-ui-security-polish.css');
  assert.match(css, /\.history-title-row \.history-intro-guidance-box\s*\{[\s\S]*?border: 1px solid/);
  assert.match(css, /\.archive-hero-guidance\s*\{[\s\S]*?width: 100%/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.archive-hero-guidance/);
});

test('manager and member Khala screens retain read-only history for every month', () => {
  const manager = read('src/features/manager/ManagerPages.jsx');
  const menu = read('src/features/menu/MenuPages.jsx');
  const managerPage = manager.slice(manager.indexOf('export function KhalaMoneyPage()'), manager.indexOf('export function ArchiveManagerPage()'));
  const memberPage = menu.slice(menu.indexOf('export function KhalaMoneyViewPage()'), menu.indexOf('export function ' , menu.indexOf('export function KhalaMoneyViewPage()') + 10));
  assert.match(managerPage, /fetchPreviousMonths\(\)/);
  assert.match(managerPage, /status === 'running' \|\| period\?\.access_kind === 'closed_by'/);
  assert.doesNotMatch(managerPage, /if \(!isOperationalManager && !hasClosedMonthAccess/);
  assert.match(memberPage, /fetchPreviousMonths\(\)/);
  assert.match(memberPage, /period\?\.access_kind === 'closed_by'/);
});

test('archive edit access page filters its visible list to the recorded closer only', () => {
  const menu = read('src/features/menu/MenuPages.jsx');
  assert.match(menu, /setPeriods\(\(Array\.isArray\(rows\) \? rows : \[\]\)\.filter\(\(period\) => period\?\.access_kind === 'closed_by'\)\)/);
});
