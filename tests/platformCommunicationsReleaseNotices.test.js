import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const app = read('src/app/App.jsx');
const shell = read('src/app/AppShell.jsx');
const overlay = read('src/components/PlatformCommunicationOverlays.jsx');
const onboarding = read('src/features/onboarding/OnboardingPage.jsx');
const invite = read('src/features/invites/HostelInvitePage.jsx');
const telegram = read('src/features/telegram/TelegramConnectionPage.jsx');
const menu = read('src/components/MenuDrawer.jsx');
const platform = read('src/features/platform/SuperAdminPage.jsx');
const service = read('src/services/platformService.js');
const migration = read('supabase/migrations/Run33_platform_communications_release_and_public_notices.sql');
const communicationsCss = read('src/styles/notification-center.css');
const entryCss = read('src/styles/invitation-experience.css');

test('new hostel success reuses the existing invitation RPC and offers code plus link share/copy', () => {
  assert.match(onboarding, /managerCreateHostelInviteLink\('নতুন মেসের সদস্য আমন্ত্রণ'\)/);
  assert.match(onboarding, /নতুন মেসের সদস্য আমন্ত্রণ/);
  assert.match(onboarding, /createdHostel\.join_code/);
  assert.match(onboarding, /navigator\.share/);
  assert.match(onboarding, /navigator\.clipboard\.writeText\(createdInviteUrl\)/);
  assert.match(onboarding, /আমন্ত্রণ লিংক/);
  assert.match(onboarding, /onboarding-share-card/);
  assert.doesNotMatch(onboarding, /manager_create_new_invite_token/);
});

test('invite route keeps the secure join-request RPC flow and compact Bengali navigation', () => {
  assert.match(invite, /createHostelJoinRequestFromInvite/);
  assert.match(invite, /getHostelInviteLinkInfo/);
  assert.match(invite, /getMyHostelJoinRequestStatus/);
  assert.match(invite, /আগের পৃষ্ঠায় যান|পরে/);
  assert.doesNotMatch(invite, /exitআমন্ত্রণ/);
});

test('release dialog is device-scoped and never shows a stale release to a first-time device', () => {
  assert.match(shell, /hostel-life-device-last-seen-release-v2/);
  assert.match(shell, /if \(!lastDeviceRelease\)[\s\S]{0,420}APP_RELEASE\.id[\s\S]{0,160}return;/);
  assert.match(shell, /lastDeviceRelease !== APP_RELEASE\.id/);
  assert.match(shell, /platformSettingsReadyForUser !== user\.id/);
  assert.match(shell, /release_notes_published/);
  assert.match(shell, /system-notice-feature-list/);
  assert.doesNotMatch(shell, /release-features-dialog|release-features-trigger/);
  assert.match(shell, /loadSettings\(true\);/);
  assert.match(shell, /refreshForRelease/);
});

test('scheduled public communications support device/day/app-open frequency without polling or event logs', () => {
  assert.match(overlay, /once_per_device/);
  assert.match(overlay, /once_per_day/);
  assert.match(overlay, /once_per_app_open/);
  assert.match(overlay, /Asia\/Dhaka/);
  assert.match(overlay, /window\.setTimeout/);
  assert.doesNotMatch(overlay, /setInterval|window\.location\.reload/);
  assert.match(app, /PlatformCommunicationOverlays/);
  assert.match(app, /withPublicCommunications\(<LoadingSpinner/);
  assert.match(communicationsCss, /platform-communication-dialog/);
  assert.match(read('src/styles/production-flow-finishing.css'), /system-notice-dialog/);
});

test('Super Admin can publish ordered release notes and scheduled message/image notices', () => {
  assert.match(platform, /আপডেট ও বিজ্ঞপ্তি/);
  assert.match(platform, /release_notes_text/);
  assert.match(platform, /release_notes_published/);
  assert.match(platform, /window_notice/);
  assert.match(platform, /site_notice/);
  assert.match(platform, /once_per_app_open/);
  assert.match(platform, /ব্যানার ছবি আপলোড \/ পরিবর্তন/);
  assert.match(platform, /আপডেট প্রকাশ করুন/);
  assert.match(platform, /বার্তা সংরক্ষণ করুন/);
  assert.match(platform, /বিজ্ঞপ্তি সংরক্ষণ করুন/);
  assert.match(platform, /saveCommunicationSection\('release_notes'\)/);
  assert.match(platform, /saveCommunicationSection\('window_notice'\)/);
  assert.match(platform, /saveCommunicationSection\('site_notice'\)/);
  assert.match(service, /platform_admin_save_communications/);
  assert.match(service, /PLATFORM_PUBLIC_SETTINGS_UPDATED_EVENT/);
  assert.match(app, /PLATFORM_PUBLIC_SETTINGS_UPDATED_EVENT/);
  assert.match(shell, /PLATFORM_PUBLIC_SETTINGS_UPDATED_EVENT/);
});

test('banner image uses an existing public bucket and a single upserted object path', () => {
  assert.match(service, /platform-communications\/maintenance-banner\.jpg/);
  assert.match(service, /upsert:\s*true/);
  assert.match(service, /cacheControl:\s*'60'/);
  assert.match(migration, /developer-assets/);
  assert.match(migration, /site_notice_image_path/);
  assert.doesNotMatch(migration, /CREATE BUCKET|CREATE TABLE[^;]*notice_impressions|cron\.schedule|pg_cron/i);
});

test('communications migration is additive, singleton, Super Admin guarded and bounded', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.platform_communications/);
  assert.match(migration, /singleton boolean PRIMARY KEY DEFAULT true CHECK \(singleton\)/);
  assert.match(migration, /private\.is_super_admin\(\)/);
  assert.match(migration, /to_regclass\('public\.hostels'\)/);
  assert.match(migration, /hl_login_sessions' AND column_name='ip_address'/);
  assert.match(migration, /hl_user_presence' AND column_name='last_login_ip'/);
  assert.match(migration, /platform_admin_get_communications/);
  assert.match(migration, /platform_admin_save_communications/);
  assert.match(migration, /public\.hostels/);
  assert.match(migration, /hl_login_sessions' AND column_name='ip_address'/);
  assert.match(migration, /hl_user_presence' AND column_name='last_login_ip'/);
  assert.match(migration, /CASE WHEN c\.window_notice_enabled THEN jsonb_build_object/);
  assert.match(migration, /CASE WHEN c\.site_notice_enabled THEN jsonb_build_object/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.platform_admin_get_communications\(\) TO authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.platform_admin_save_communications\(jsonb\) TO authenticated/);
  assert.match(migration, /cardinality\(v_notes\) > 30/);
  assert.match(migration, /length\(n\) > 240/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM public\./i);
});

test('member directory extension adds Telegram data to the existing scoped RPC without dropping fields', () => {
  assert.match(migration, /platform_admin_list_hostel_members_v3/);
  assert.match(migration, /'telegram_connected'/);
  assert.match(migration, /'telegram_username'/);
  assert.match(platform, /toWhatsAppUrl\(member\.phone\)/);
  assert.match(platform, /টেলিগ্রাম সংযুক্ত/);
  assert.match(platform, /হোয়াটসঅ্যাপে খুলুন/);
});

test('Telegram menu and connection labels remain Bengali and use the monochrome official mark', () => {
  assert.match(menu, /টেলিগ্রাম সংযোগ/);
  assert.match(menu, /TelegramLogo size=\{18\} monochrome/);
  assert.match(telegram, /টেলিগ্রাম সংযোগ/);
  assert.match(telegram, /সংযোগ যাচাই/);
  assert.match(telegram, /টেলিগ্রাম খুলুন/);
  assert.match(telegram, /TelegramLogo/);
});

test('entry theme overrides apply current theme tokens instead of hard-coded dark copy', () => {
  assert.match(entryCss, /\.auth-page \.auth-form-panel \.auth-header p[\s\S]*?color: var\(--muted\) !important/);
  assert.match(entryCss, /\.onboarding-page \.onboarding-brand-header h1[\s\S]*?color: var\(--text\) !important/);
  assert.match(entryCss, /\.hostel-invite-page \.hostel-invite-lead[\s\S]*?color: var\(--muted\) !important/);
});

test('communications editor fails closed when the initial server read fails and validates publish bounds before saving', () => {
  assert.match(platform, /communicationsLoaded/);
  assert.match(platform, /if \(!communicationsLoaded \|\| !communicationsSavedDraftRef\.current \|\| communicationsBusy\)[\s\S]{0,280}সংরক্ষণ করা যাবে না/);
  assert.match(platform, /!communicationsLoaded \? <section className=\"card platform-panel platform-communications-load-error\"/);
  assert.match(platform, /onClick=\{loadCommunications\} disabled=\{communicationsLoading\}/);
  assert.match(platform, /lines\.length > 30/);
  assert.match(platform, /lines\.some\(\(line\) => line\.length > 240\)/);
  assert.match(platform, /communicationsSavedDraftRef/);
});

test('public communication dialog supports Escape and prevents background page scrolling while open', () => {
  const dialog = read('src/components/SystemNoticeDialog.jsx');
  assert.match(dialog, /closeButtonRef/);
  assert.match(dialog, /event\.key === 'Escape'/);
  assert.match(dialog, /document\.body\.style\.overflow = 'hidden'/);
  assert.match(dialog, /window\.removeEventListener\('keydown', handleKeyDown\)/);
  assert.match(overlay, /<SystemNoticeDialog imageOnly/);
});
