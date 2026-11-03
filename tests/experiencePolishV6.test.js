import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const shell = read('src/app/AppShell.jsx');
const platform = read('src/features/platform/SuperAdminPage.jsx');
const actionDialogs = read('src/utils/actionDialogs.js');
const main = read('src/main.jsx');
const styles = read('src/styles/experience-polish-v6.css');
const telegram = read('src/features/telegram/TelegramConnectionPage.jsx');
const installHook = read('src/hooks/useInstallPrompt.js');
const downloadPage = read('src/features/menu/AppDownloadPage.jsx');
const auth = read('src/features/auth/AuthPage.jsx');

test('global notice cannot be dismissed by a user and remains visible while enabled', () => {
  assert.match(shell, /const systemAnnouncementVisible = Boolean\(platformSettings\?\.announcement_enabled/);
  assert.match(shell, /global-system-announcement/);
  assert.match(shell, /window\.addEventListener\('focus', refreshWhenVisible\)/);
  assert.match(shell, /document\.addEventListener\('visibilitychange', onVisibilityChange\)/);
  assert.match(shell, /< 30_000/);
  assert.doesNotMatch(shell, /dismissSystemAnnouncement|dismissedSystemNoticeSignature|global-announcement-dismiss/);
  assert.match(platform, /ব্যবহারকারী নিজে বন্ধ করতে পারবেন না/);
  assert.match(styles, /\.global-system-announcement\s*\{[\s\S]*?position:\s*sticky/);
});

test('scheduled notices support replacing saved time with current Dhaka time or clearing it', () => {
  assert.match(platform, /function DateTimeField\(/);
  assert.match(platform, /toDhakaDateTimeInput\(new Date\(\)\)/);
  assert.match(platform, /বর্তমান বাংলাদেশ সময় বসান/);
  assert.match(platform, /onChange\(''\)/);
  assert.match(platform, /id="window-notice-starts-at"/);
  assert.match(platform, /id="site-notice-starts-at"/);
  assert.match(platform, /min=\{communicationsDraft\.window_notice\.starts_at/);
  assert.match(platform, /min=\{communicationsDraft\.site_notice\.starts_at/);
  assert.match(styles, /\.platform-datetime-control/);
});

test('admin message confirmation has a specific safe send action and responsive presentation', () => {
  assert.match(platform, /title: 'বার্তা পাঠানোর আগে নিশ্চিত হন', confirmLabel: 'বার্তা পাঠান', kind: 'message'/);
  assert.match(actionDialogs, /options\.title/);
  assert.match(actionDialogs, /options\.confirmLabel/);
  assert.match(actionDialogs, /hl-action-panel-\$\{options\.kind/);
  assert.match(styles, /\.hl-action-panel-message/);
  assert.match(styles, /@media \(max-width: 360px\)[\s\S]*?\.hl-action-buttons/);
});

test('Telegram connection page centers its own recognizable logo without changing the connection RPC flow', () => {
  assert.match(telegram, /className="telegram-card-hero"/);
  assert.match(telegram, /<TelegramLogo size=\{52\}/);
  assert.match(telegram, /createMyTelegramLink\(\)/);
  assert.match(telegram, /getMyTelegramNotificationStatus\(\)/);
  assert.match(telegram, /unlinkMyTelegram\(\)/);
  assert.match(styles, /\.telegram-card-hero\s*\{[\s\S]*?justify-items:\s*center/);
});

test('release feature modal displays Hostel Life brand mark instead of generic Gemini-like sparkle', () => {
  assert.match(shell, /<BrandMark size=\{42\}\/>/);
  assert.doesNotMatch(shell, /release-notice-icon"><Icon name="sparkles"/);
});

test('install prompt is captured before React effects and app download page has platform-specific manual steps', () => {
  assert.match(installHook, /installBrowserListeners\(\);\s*\n\s*export function useInstallPrompt/);
  assert.match(installHook, /window\.addEventListener\('beforeinstallprompt'/);
  assert.match(installHook, /window\.addEventListener\('appinstalled'/);
  assert.match(downloadPage, /iPhone বা iPad-এ ইনস্টল/);
  assert.match(downloadPage, /Android-এ ইনস্টল/);
  assert.match(downloadPage, /কম্পিউটারে ইনস্টল/);
  assert.match(downloadPage, /navigator\.userAgent/);
});

test('auth screen refinement remains scoped and uses the selected theme tokens', () => {
  assert.match(auth, /function AuthFrame/);
  assert.match(auth, /EntryThemeSwitcher/);
  assert.match(styles, /\.auth-shell:not\(\.auth-shell-compact\)/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.auth-shell \.auth-form-panel/);
  assert.match(styles, /background: var\(--surface\)/);
});

test('v6 presentation stylesheet is loaded after all existing application styles', () => {
  assert.match(main, /import '\.\/styles\/experience-polish-v6\.css';/);
  assert.ok(main.indexOf("import './styles/experience-polish-v6.css'") > main.indexOf("import './styles/super-admin-experience.css'"));
});
