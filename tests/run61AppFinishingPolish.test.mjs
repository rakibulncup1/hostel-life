import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const app = read('src/app/App.jsx');
const shell = read('src/app/AppShell.jsx');
const archive = read('src/features/archive/ArchiveCorrectionPage.jsx');
const history = read('src/features/history/HistoryPage.jsx');
const historyService = read('src/services/historyService.js');
const download = read('src/features/menu/AppDownloadPage.jsx');
const telegram = read('src/features/telegram/TelegramConnectionPage.jsx');
const menuPages = read('src/features/menu/MenuPages.jsx');
const legalContent = read('src/content/legalDocuments.js');
const dining = read('src/features/dining/DiningPage.jsx');
const header = read('src/components/Header.jsx');
const platform = read('src/features/platform/SuperAdminPage.jsx');
const finishCss = read('src/styles/app-finish-polish-v61.css');
const main = read('src/main.jsx');
const publicPrivacy = read('public/privacy-policy.html');
const publicTerms = read('public/terms-of-service.html');
const retentionMigration = read('supabase/migrations/Run47_ip_session_metadata_retention_30d.sql');
const retentionVerify = read('supabase/verify/Verify_Run47_ip_session_metadata_retention_30d.sql');

test('closed-month entry points use the advanced archive page and preserve closer-only edits', () => {
  assert.match(app, /pathname === '\/app\/menu\/archive'\) return <ArchiveCorrectionPage \/>/);
  assert.match(shell, /archive: '\/app\/menu\/archive'/);
  assert.match(history, /navigateTo\(`\/app\/menu\/archive\?period_id=/);
  assert.match(menuPages, /navigateTo\(`\/app\/menu\/archive\?period_id=/);
  assert.doesNotMatch(menuPages, /function ArchiveDetailModal\(/);
  assert.match(archive, /fetchArchiveManagementItems\(\) : fetchPreviousMonths\(\)/);
  assert.match(archive, /access_kind === 'closed_by'/);
  assert.match(archive, /editablePeriods\.some\([\s\S]*getArchiveCorrectionBundle\(id\)/);
  assert.match(archive, /applyArchiveCorrection\(/);
  assert.match(archive, /archiveView === 'correction'/);
  assert.match(archive, /archiveView === 'report'/);
  assert.ok(archive.includes('<ReadOnlyReport detail={detail}/>'));
  assert.match(historyService, /get_archived_month_detail/);
});

test('archive full report exposes member, market, meal, ledger, khala and audit sections without new database writes', () => {
  for (const section of ["['market', 'বাজার'", "['meals', 'ফাইনাল মিল'", "['ledger', 'লেনদেন'", "['members', 'সদস্যের হিসাব'", "['khala', 'খালার টাকা'", "['audit', 'সংশোধন ইতিহাস'"]) {
    assert.ok(archive.includes(section), `archive report tab missing ${section}`);
  }
  assert.match(archive, /detail\.members/);
  assert.match(archive, /detail\.khala_entries/);
  assert.match(archive, /row\.items/);
  assert.doesNotMatch(archive, /INSERT INTO|UPDATE public\./i);
});

test('market edit metadata is hidden until a genuine later edit and card layout pairs its key fields', () => {
  assert.match(history, /updated > created/);
  assert.match(history, /hasActualMarketUpdate\(row\) &&/);
  assert.match(history, /history-market-title-row/);
  assert.match(history, /history-market-item-count/);
  assert.doesNotMatch(history, /history-market-bottom-row|history-row-open-hint/);
  assert.match(finishCss, /\.history-market-title-row/);
  assert.match(finishCss, /\.history-market-copy \.history-market-item-count/);
  assert.match(finishCss, /\.history-market-serial/);
});

test('market entry places the serial inside the item-name field without changing saved item text', () => {
  const diningV2 = read('src/styles/dining-experience-v2.css');
  const fieldStart = dining.indexOf('<div className="market-item-name-field">');
  const fieldEnd = dining.indexOf('</div>', fieldStart);
  const fieldMarkup = dining.slice(fieldStart, fieldEnd);
  assert.match(fieldMarkup, /market-item-index/);
  assert.match(fieldMarkup, /<textarea/);
  assert.match(dining, /value=\{item\.item_name\}/);
  assert.doesNotMatch(dining, /item_name:\s*`?\$\{index \+ 1\}/);
  assert.match(diningV2, /\.market-item-name-field/);
  assert.match(diningV2, /market-item-name-field \.market-input-item \{ min-height: 44px; padding-left: 42px;/);
  assert.match(diningV2, /market-item-name-field \{ grid-column: 1 \/ -1;/);
});

test('app install page uses the real PWA prompt and does not advertise a nonexistent APK', () => {
  assert.match(download, /useInstallPromptContext/);
  assert.match(download, /canInstall/);
  assert.match(download, /installNow/);
  assert.match(download, /Add to Home Screen/);
  assert.match(download, /Install app/);
  assert.doesNotMatch(download, /\.apk|\.aab|firebase\.appdistribution/i);
  assert.match(download, /iPhone বা iPad-এ ইনস্টল/);
});

test('Telegram connection UI keeps the existing secure link, verify and unlink RPC paths', () => {
  assert.match(telegram, /createMyTelegramLink\(\)/);
  assert.match(telegram, /getMyTelegramNotificationStatus\(\)/);
  assert.match(telegram, /unlinkMyTelegram\(\)/);
  assert.match(telegram, /সংযোগ যাচাই/);
  assert.match(telegram, /সংযোগ বিচ্ছিন্ন/);
  assert.match(finishCss, /\.telegram-connection-card/);
});

test('privacy disclosures match current geo-disabled and retention behavior across app and public pages', () => {
  for (const policy of [legalContent, publicPrivacy]) {
    assert.match(policy, /GPS/);
    assert.match(policy, /দেশ[, ]? শহর বা অঞ্চল/);
    assert.match(policy, /৩০ দিনের?/);
    assert.match(policy, /ইন্টারনেট সংযোগের ঠিকানা \(IP address\)/);
    assert.match(policy, /Google Sign-In সংযুক্ত করা হয়েছে এবং এটি ঐচ্ছিক/);
    assert.match(policy, /Google আপনার পরিচয় যাচাই করে আপনার নাম, ইমেইল ঠিকানা/);
    assert.match(policy, /Google Sign-In সংযুক্ত করা হয়েছে এবং এটি ঐচ্ছিক/);
  }
  assert.match(legalContent, /Password, OTP code/);
  assert.match(publicPrivacy, /Password, OTP code/);
  assert.match(legalContent, /ঐচ্ছিক টেলিগ্রাম সংযোগ/);
  assert.match(publicPrivacy, /ঐচ্ছিক টেলিগ্রাম সংযোগ/);
  assert.match(legalContent, /টেলিগ্রাম চ্যাট আইডি/);
  assert.match(publicPrivacy, /টেলিগ্রাম চ্যাট আইডি/);
  assert.match(publicPrivacy, /আপনার তথ্য বিক্রি বা ভাড়া দেওয়া হয় না/);
});

test('terms align in-app and public rules for private invitations and public site links', () => {
  for (const terms of [legalContent, publicTerms]) {
    assert.match(terms, /ব্যক্তিগত আমন্ত্রণের Join Code ও Invitation Link সুরক্ষিত রাখুন/);
    assert.match(terms, /ব্যক্তিগত Join Code ও Invitation Link/);
    assert.match(terms, /ওয়েবসাইটের সাধারণ ঠিকানা বা Hostel Life-এর পরিচিতি পেজ প্রকাশ্যে শেয়ার করা যায়/);
  }
});

test('shared UI finishing stylesheet is loaded last and keeps back controls compact', () => {
  assert.match(main, /app-finish-polish-v61\.css/);
  assert.ok(main.indexOf('app-finish-polish-v61.css') > main.indexOf('run53_info_box_icon_cleanup.css'));
  assert.match(finishCss, /\.subpage-back-row > button/);
  assert.match(finishCss, /min-height: 28px/);
  assert.match(header, /brand-name-row/);
  assert.match(header, /header-period-badge/);
  assert.match(finishCss, /\.brand-name-row \.header-period-badge/);
});

test('unnecessary help and market-entry instruction boxes are absent; Super Admin minute label stays short', () => {
  for (const source of [menuPages, dining]) {
    assert.doesNotMatch(source, /সহায়তার জন্য নিচের মাধ্যমগুলো ব্যবহার করুন/);
    assert.doesNotMatch(source, /তারিখ ও বাজারকারীর তথ্য দিয়ে আইটেম যোগ করুন/);
  }
  assert.match(platform, /১ মিনিটে:|একই IP · ১ মিনিট/);
  assert.doesNotMatch(platform, /৬০ সেকেন্ডে একই IP থেকে কতবার/);
});


test('app-managed session IP and browser metadata are cleared after 30 days without changing session authorization', () => {
  assert.match(retentionMigration, /CREATE TRIGGER hl_login_sessions_metadata_retention/);
  assert.match(retentionMigration, /CREATE TRIGGER hl_user_presence_metadata_retention/);
  assert.match(retentionMigration, /logged_in_at < v_now - interval '30 days'/);
  assert.match(retentionMigration, /last_login_at < v_now - interval '30 days'/);
  assert.match(retentionMigration, /ip_address=NULL, user_agent=NULL/);
  assert.match(retentionMigration, /last_login_ip=NULL, last_user_agent=NULL/);
  assert.doesNotMatch(retentionMigration, /last_user_agent=CASE[\s\S]{0,180}last_user_agent=COALESCE/);
  assert.match(retentionMigration, /CREATE OR REPLACE FUNCTION public\.hl_touch_my_presence\(\)/);
  assert.match(retentionMigration, /logged_in_at >= now\(\)-interval '30 days'/);
  assert.match(retentionMigration, /CREATE OR REPLACE FUNCTION private\.hl_prune_platform_logs\(\)/);
  assert.match(retentionMigration, /blocked_until <= v_now/);
  assert.doesNotMatch(retentionMigration, /DROP TABLE|TRUNCATE|DELETE FROM public\.(profiles|hostel_memberships|monthly_periods|daily_meal_records)/i);
  assert.match(retentionVerify, /hl_login_sessions_metadata_retention/);
  assert.match(legalContent, /ইন্টারনেট সংযোগের ঠিকানা \(IP address\).*সাধারণ তথ্য ৩০ দিন পর মুছে ফেলা হয়/);
  assert.match(publicPrivacy, /ইন্টারনেট সংযোগের ঠিকানা \(IP address\).*সাধারণ তথ্য ৩০ দিন পর মুছে ফেলা হয়/);
});
