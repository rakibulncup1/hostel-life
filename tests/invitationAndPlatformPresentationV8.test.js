import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manager = read('src/features/manager/ManagerPages.jsx');
const invite = read('src/features/invites/HostelInvitePage.jsx');
const onboarding = read('src/features/onboarding/OnboardingPage.jsx');
const appDownload = read('src/features/menu/AppDownloadPage.jsx');
const appShell = read('src/app/AppShell.jsx');
const main = read('src/main.jsx');
const appRouter = read('src/app/App.jsx');
const drawer = read('src/components/MenuDrawer.jsx');
const superAdmin = read('src/features/platform/SuperAdminPage.jsx');
const styles = read('src/styles/invitation-experience.css');
const publicStyles = read('src/styles/public-entry.css');

function getSection(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `Missing section start: ${start}`);
  const endAt = source.indexOf(end, startAt);
  assert.notEqual(endAt, -1, `Missing section end: ${end}`);
  return source.slice(startAt, endAt);
}

test('Invitation Settings is compact and exposes one Copy & Share action without token history', () => {
  const settings = getSection(manager, 'export function HostelSettingsPage()', 'function JoinRequestQueue()');
  assert.match(settings, /managerCreateHostelInviteLink\('সদস্য আমন্ত্রণ'\)/);
  assert.match(settings, /copyAndShareInvite/);
  assert.match(settings, /navigator\.share\(shareData\)/);
  assert.match(settings, /clipboardPayload = shareTask \? createdInviteUrl : `\$\{shareData\.text\}\\n\$\{createdInviteUrl\}`/);
  assert.match(settings, /copyText\(clipboardPayload\)/);
  assert.match(settings, /membership\?\.hostel_name/);
  assert.match(settings, /কপি ও শেয়ার করুন/);
  assert.match(settings, /নতুন লিংক তৈরি করলে আগেরটি স্বয়ংক্রিয়ভাবে বাতিল হবে/);
  assert.doesNotMatch(settings, /managerListHostelInviteLinks|managerRevokeHostelInviteLink|inviteLinks|manager-invite-history|manager-invite-url/);
});

test('Invitation create rotation remains server-side and the UI does not recreate seven-day policy locally', () => {
  const service = read('src/services/hostelInviteService.js');
  const migration = read('supabase/migrations/Run29_invitation_link_rotation.sql');
  assert.match(service, /manager_create_or_rotate_hostel_invite_link/);
  assert.match(migration, /now\(\) \+ interval '7 days'/);
  assert.match(migration, /revoked_at = coalesce\(revoked_at, now\(\)\)/);
  assert.match(migration, /manager_create_or_rotate_hostel_invite_link/);
});

test('Native share metadata may name the hostel while the bearer token remains in the URL fragment', () => {
  const settings = getSection(manager, 'const copyAndShareInvite = async () =>', 'const saveName = async');
  assert.match(settings, /title: `\$\{hostelName\}/);
  assert.match(settings, /text: `\$\{hostelName\}/);
  assert.match(settings, /url: createdInviteUrl/);
  assert.match(manager, /\/invite#\$\{result\.token\}/);
  assert.doesNotMatch(read('index.html'), /hostel_name|invite_token/i);
});

test('Unauthenticated invite landing has registration only, no login action, and a clear exit path', () => {
  const branchStart = invite.indexOf('{!auth.isAuthenticated ?');
  const branchEnd = invite.indexOf(': <>', branchStart);
  assert.ok(branchStart >= 0 && branchEnd > branchStart);
  const unauthBranch = invite.slice(branchStart, branchEnd);
  assert.match(unauthBranch, /navigateTo\('\/auth\/register'\)/);
  assert.doesNotMatch(unauthBranch, /auth\/login|লগইন/);
  assert.match(invite, /hostel-invite-exit/);
  assert.match(invite, /const exitInvitation/);
  assert.match(invite, /navigateTo\('\/onboarding', true\)/);
  assert.match(onboarding, /onboarding-invite-exit/);
  assert.match(onboarding, /clearPendingLink/);
});

test('Join Request review remains manager/assistant-authorized but now has structured identity and decision cards', () => {
  const queue = getSection(manager, 'function JoinRequestQueue()', 'export function JoinRequestReviewPage()');
  assert.match(queue, /managerListHostelJoinRequests\(\)/);
  assert.match(queue, /managerReviewHostelJoinRequest\(row\.id, approve, reviewNote\)/);
  assert.match(queue, /manager-request-avatar/);
  assert.match(queue, /manager-request-status/);
  assert.match(queue, /manager-request-message/);
  assert.match(queue, /manager-request-empty/);
  assert.match(styles, /\.manager-request-person/);
  assert.match(styles, /\.manager-join-request-actions/);
});

test('PWA install listener is held at application root so the menu action does not miss the browser event', () => {
  assert.match(main, /function AppWithInstallPrompt\(\)/);
  assert.match(main, /useInstallPrompt\(\)/);
  assert.match(main, /<InstallPromptProvider value=\{installPrompt\}><App \/><\/InstallPromptProvider>/);
  assert.match(appShell, /useInstallPromptContext/);
  assert.doesNotMatch(appShell, /useInstallPrompt\(/);
  assert.match(appDownload, /canInstall \? \(/);
  assert.match(appDownload, /install\(\)/);
  assert.match(drawer, /key: 'app-download', label: 'অ্যাপ ডাউনলোড'/);
  assert.doesNotMatch(drawer, /install-card/);
});

test('Install guidance stays honest where a browser does not expose a one-click PWA prompt', () => {
  assert.match(appDownload, /এই ব্রাউজার এখন সরাসরি ইনস্টল অনুমতি দিচ্ছে না/);
  assert.doesNotMatch(appDownload, /তিন ডট|3 dot|browser settings/i);
  assert.match(read('src/hooks/useInstallPrompt.js'), /beforeinstallprompt/);
});

test('Super Admin separates system configuration from monitoring navigation', () => {
  assert.match(superAdmin, /platform-navigation-group/);
  assert.match(superAdmin, /platform-main-tabs/);
  assert.match(superAdmin, /platform-config-tabs/);
  for (const key of ["\['settings','Global Notice'\]", "\['developer','Developer Info'\]", "\['appearance','App Theme'\]", "\['sessions','Session Security'\]"]) {
    assert.ok(superAdmin.includes(key), `Missing independent setting tab ${key}`);
  }
  for (const marker of ['platform-settings-intro', 'গ্লোবাল নোটিশ', 'ডেভেলপার ও সহায়তা তথ্য', 'অ্যাপের ডিফল্ট থিম', 'Session নিরাপত্তা']) {
    assert.ok(superAdmin.includes(marker), `Missing section heading ${marker}`);
  }
  assert.match(styles, /\.platform-navigation \.platform-main-tabs/);
  assert.match(styles, /\.platform-navigation \.platform-config-tabs/);
});

test('Auth and onboarding headings use theme tokens and invitation views are responsive', () => {
  assert.match(styles, /\.auth-form-panel \.auth-header h2 \{ color: var\(--text\) !important/);
  assert.match(styles, /\.onboarding-brand-header p/);
  assert.match(styles, /color: var\(--muted\) !important/);
  assert.match(styles, /@media \(max-width: 520px\)/);
  assert.match(publicStyles, /:root\[data-theme="blue"\]/);
  assert.match(publicStyles, /:root\[data-theme="dark"\]/);
  assert.match(publicStyles, /:root\[data-theme="light"\]/);
});


test('Join Request route is registered once to avoid redundant route branches', () => {
  const matches = appRouter.match(/if \(pathname === '\/app\/menu\/join-requests'\)/g) || [];
  assert.equal(matches.length, 1);
});
