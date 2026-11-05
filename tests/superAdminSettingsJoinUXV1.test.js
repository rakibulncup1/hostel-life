import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const onboarding = read('src/features/onboarding/OnboardingPage.jsx');
const platform = read('src/features/platform/SuperAdminPage.jsx');
const overlay = read('src/components/PlatformCommunicationOverlays.jsx');
const noticeDialog = read('src/components/SystemNoticeDialog.jsx');
const shell = read('src/app/AppShell.jsx');
const styles = read('src/styles/super-admin-experience.css');
const polishStyles = read('src/styles/experience-polish-v6.css');
const main = read('src/main.jsx');

test('onboarding starts with a compact choice screen and no expanded join-code form', () => {
  assert.match(onboarding, /const \[mode, setMode\] = useState\(''\)/);
  assert.match(onboarding, /\{mode && <section id="onboarding-action-panel"/);
  assert.match(onboarding, /aria-expanded=\{mode === 'join'\}/);
  assert.match(onboarding, /aria-expanded=\{mode === 'create'\}/);
  assert.match(onboarding, /অন্য পদ্ধতি বেছে নিন/);
  assert.doesNotMatch(onboarding, /const \[mode, setMode\] = useState\('join'\)/);
});

test('communication windows are not marked as seen until the user dismisses them', () => {
  const activateAt = overlay.indexOf('setActiveCampaign(next)');
  const markAt = overlay.indexOf('markShown(activeCampaign)');
  assert.ok(activateAt >= 0 && markAt > activateAt);
  const activationEffect = overlay.slice(overlay.indexOf('if (blocked || activeCampaign) return;'), activateAt);
  assert.doesNotMatch(activationEffect, /markShown\(|shownThisRender\.current\.add/);
  assert.match(overlay, /const closeActiveCampaign = \(\) =>/);
  assert.match(overlay, /shownThisRender\.current\.add\(key\)/);
  assert.match(overlay, /markShown\(activeCampaign\)/);
});

test('communication dialog remains keyboard dismissible and traps focus accessibly', () => {
  assert.match(overlay, /<SystemNoticeDialog/);
  assert.match(noticeDialog, /event\.key === 'Escape'/);
  assert.match(noticeDialog, /event\.key === 'Tab'/);
  assert.match(noticeDialog, /dialogRef\.current\?\.querySelectorAll/);
  assert.match(noticeDialog, /className="system-notice-close"/);
  assert.match(noticeDialog, /aria-modal="true"/);
});

test('global system banner stays pinned for every user until Super Admin disables it', () => {
  assert.match(shell, /const systemAnnouncementVisible = Boolean/);
  assert.match(shell, /global-system-announcement/);
  assert.doesNotMatch(shell, /dismissedSystemNoticeSignature|hostel-life-global-system-notice-dismissed-v1|global-announcement-dismiss/);
  const banner = shell.slice(shell.indexOf('global-system-announcement'), shell.indexOf('pinnedManagerNotice &&'));
  assert.doesNotMatch(banner, /button[^>]*aria-label=.*বন্ধ/);
});

test('priority system messages also have a visible close control connected to acknowledgement', () => {
  assert.match(shell, /onClose=\{dismissPriorityMessage\}/);
  assert.match(noticeDialog, /className="system-notice-close"/);
});

test('communications editor explains scheduling, previews release notes and fails closed on every reload error', () => {
  const load = platform.slice(platform.indexOf('const loadCommunications'), platform.indexOf('useEffect(() => {\n    if (tab === \'communications\''));
  assert.match(load, /setCommunicationsLoaded\(false\)/);
  assert.match(platform, /platform-communications-guide/);
  assert.match(platform, /platform-release-preview/);
  assert.match(platform, /প্রকাশিত/);
  assert.match(platform, /প্রতি ব্রাউজার সেশনে একবার/);
  assert.match(platform, /প্রতিটি কার্ডের নিচে আলাদা সংরক্ষণ বোতাম আছে/);
  assert.match(platform, /saveCommunicationSection\('release_notes'\)/);
  assert.match(platform, /saveCommunicationSection\('window_notice'\)/);
  assert.match(platform, /saveCommunicationSection\('site_notice'\)/);
});

test('Super Admin settings and onboarding styles are loaded and mobile readable', () => {
  assert.match(main, /super-admin-experience\.css/);
  assert.match(styles, /\.platform-communications-guide-steps/);
  assert.match(polishStyles, /\.global-system-announcement \{/);
  assert.match(styles, /\.onboarding-mode-copy small\s*\{\s*font-size: 12px/);
  assert.match(styles, /@media \(max-width: 620px\)/);
});

test('communication sections save independently without overwriting or discarding other drafts', () => {
  assert.match(platform, /const releaseSource = section === 'release_notes' \? current : saved/);
  assert.match(platform, /const windowSource = section === 'window_notice' \? current\.window_notice : saved\.window_notice/);
  assert.match(platform, /const siteSource = section === 'site_notice' \? current\.site_notice : saved\.site_notice/);
  assert.match(platform, /communicationsSavedDraftRef\.current = JSON\.parse\(JSON\.stringify\(savedNext\)\)/);
  assert.match(platform, /একটির Save অন্য দুটি অংশ পরিবর্তন করবে না/);
  assert.doesNotMatch(platform, /onSubmit=\{saveCommunications\}/);
});

test('system settings and session policy fail closed until their saved values load', () => {
  assert.match(platform, /const \[settingsLoaded, setSettingsLoaded\] = useState\(false\)/);
  assert.match(platform, /const \[sessionPolicyLoaded, setSessionPolicyLoaded\] = useState\(false\)/);
  assert.match(platform, /setSettingsLoaded\(true\)/);
  assert.match(platform, /setSessionPolicyLoaded\(true\)/);
  assert.match(platform, /!settingsLoaded \? <section className="card platform-panel platform-settings-load-state"/);
  assert.match(platform, /!sessionPolicyLoaded \? <section className="card platform-panel platform-settings-load-state"/);
  assert.match(platform, /if \(!settingsLoaded\) \{ setError\('সেটিংসের সংরক্ষিত তথ্য আগে সফলভাবে লোড করুন।'\)/);
  assert.match(platform, /if \(!settingsLoaded \|\| !sessionPolicyLoaded\)/);
});

test('public settings tabs preserve the other tab server values when saving', () => {
  assert.match(platform, /const settingsSavedRef = useRef\(null\)/);
  assert.match(platform, /settingsSavedRef\.current = \{ \.\.\.settingsValue \}/);
  assert.match(platform, /const announcementFields = \['announcement_enabled', 'announcement_title', 'announcement_body'\]/);
  assert.match(platform, /const developerFields = \['developer_name', 'developer_title', 'developer_photo_url', 'developer_email', 'developer_phone', 'developer_portfolio_url'\]/);
  assert.match(platform, /fieldsToSave\.forEach\(\(key\) => \{ payload\[key\] = settings\[key\]; \}\)/);
});

test('access-code gate toggles stay disabled until the server settings are confirmed', () => {
  assert.match(platform, /checked=\{Boolean\(settings\.registration_code_required\)\} disabled=\{busy \|\| !settingsLoaded\}/);
  assert.match(platform, /checked=\{Boolean\(settings\.hostel_creation_code_required\)\} disabled=\{busy \|\| !settingsLoaded\}/);
  assert.match(platform, /Code gate-এর সংরক্ষিত অবস্থা লোড হয়নি/);
});


test('developer photo upload help points to the actual section-specific save action', () => {
  assert.match(platform, /Developer Info-তে স্থায়ী করতে “সহায়তা তথ্য সংরক্ষণ করুন” চাপুন/);
  assert.doesNotMatch(platform, /Developer Info-তে স্থায়ী করতে “সব সেটিংস সংরক্ষণ করুন” চাপুন/);
});
