import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const shell = read('src/app/AppShell.jsx');
const market = read('src/features/dining/DiningPage.jsx');
const auth = read('src/features/auth/AuthPage.jsx');
const onboarding = read('src/features/onboarding/OnboardingPage.jsx');
const css = read('src/styles/production-flow-finishing.css');
const main = read('src/main.jsx');
const vite = read('vite.config.js');
const notice = read('src/components/SystemNoticeDialog.jsx');
const marketShare = read('src/utils/marketShare.js');
const campaigns = read('src/components/PlatformCommunicationOverlays.jsx');
const admin = read('src/features/platform/SuperAdminPage.jsx');
const migration = read('supabase/migrations/Run33_platform_communications_release_and_public_notices.sql');

test('mobile market input updates do not programmatically steal focus on every keystroke', () => {
  const update = market.slice(market.indexOf('const updateItem ='), market.indexOf('const focusMarketField ='));
  assert.match(update, /setItems\(\(current\) => current\.map/);
  assert.doesNotMatch(update, /requestAnimationFrame|\.focus\(|document\.activeElement/);
  assert.match(market, /key=\{`item-\$\{index\}`\}/);
  assert.match(market, /moveToNextMarketField/);
  assert.match(market, /enterKeyHint="next"/);
});

test('short share is generated only after a successful market save and persists while the native share sheet is open', () => {
  const marketForm = market.slice(market.indexOf('function MarketEntryForm('), market.indexOf('function ManagerMealEntry('));
  const submit = marketForm.slice(marketForm.indexOf('const submit = async'), marketForm.indexOf('return ('));
  assert.match(submit, /await createMarketEntry\(/);
  assert.match(submit, /setShareSummary\(nextShareSummary\)/);
  assert.match(submit, /sessionStorage\.setItem\(marketShareStorageKey/);
  assert.ok(submit.indexOf('await createMarketEntry(') < submit.indexOf('setShareSummary(nextShareSummary)'));
  assert.match(marketForm, /navigator\.share\(\{[\s\S]*?title: 'Hostel Life · বাজারের তালিকা',[\s\S]*?text: shareSummary\.text/);
  assert.match(marketForm, /navigator\.clipboard\.writeText\(shareSummary\.text\)/);
  assert.match(marketForm, /const copyAndShareSavedMarket = async/);
  assert.match(marketForm, /buildMarketShareText\(\{/);
  assert.match(marketShare, /`তারিখ : \${dateLabel}`/);
  assert.match(marketShare, /`বাজারকারী: \${getMarketBuyerFirstName\(buyerName\)}`/);
  assert.match(marketShare, /`টোটাল বাজার = \${formatNumber/);
  assert.match(marketForm, /<SystemNoticeDialog/);
  assert.match(marketForm, /কপি এন্ড শেয়ার/);
  assert.match(marketForm, /onClick=\{copyAndShareSavedMarket\}/);
  assert.doesNotMatch(marketForm, /market-short-share/);
});

test('auth and onboarding late overrides use selected theme tokens for light, blue and dark themes', () => {
  assert.match(main, /production-flow-finishing\.css/);
  assert.match(css, /\.auth-page \.auth-form-panel \.auth-header h2[\s\S]*?color: var\(--text\)/);
  assert.match(css, /\.auth-page \.auth-form-panel \.auth-header p[\s\S]*?color: var\(--muted\)/);
  assert.match(css, /\.onboarding-main-card \.creation-success-card h2 \{ color: var\(--text\)/);
  assert.match(css, /\.onboarding-main-card \.join-code-box/);
  assert.match(auth, /auth-form-panel/);
  assert.match(onboarding, /কোড দিয়ে যুক্ত হন/);
  assert.match(onboarding, /১২ অক্ষরের সঠিক যুক্ত হওয়ার কোড দিন/);
});

test('Excel paste instructions receive the same bordered theme-aware panel in every theme', () => {
  assert.match(css, /\.market-paste-hint \{[\s\S]*?background: color-mix\(in srgb, var\(--primary-soft\)/);
  assert.match(css, /border: 1px solid color-mix\(in srgb, var\(--primary\)/);
});

test('release modal waits for a fresh server settings response and displays published notes inline', () => {
  assert.match(shell, /loadSettings\(true\);/);
  assert.match(shell, /platformSettingsReadyForUser !== user\.id/);
  assert.match(shell, /communications\?\.release_notes_published === true/);
  assert.match(shell, /system-notice-feature-list/);
  assert.doesNotMatch(shell, /release-features-dialog|release-features-trigger|নতুন ফিচারসমূহ/);
  assert.match(vite, /const releaseId = `\$\{commit\.slice\(0, 12\)\}-\$\{builtAt\}`/);
  assert.match(vite, /__HOSTEL_LIFE_RELEASE__/);
});

test('release and priority modals share one accessible dialog component', () => {
  assert.match(shell, /<SystemNoticeDialog/);
  assert.match(campaigns, /<SystemNoticeDialog/);
  assert.match(notice, /event\.key === 'Escape'/);
  assert.match(notice, /event\.key !== 'Tab'/);
  assert.match(notice, /document\.body\.style\.overflow = 'hidden'/);
  assert.match(notice, /closeButtonRef/);
});

test('image notice mode contains only the uploaded banner and a close action', () => {
  assert.match(campaigns, /<SystemNoticeDialog imageOnly imageUrl=/);
  assert.match(notice, /imageOnly \? <img src=\{imageUrl\}/);
  assert.match(campaigns, /campaign\.mode === 'image' && !campaign\.image_url/);
});

test('scheduled notices preserve all existing browser-frequency choices and only mark seen on dismissal', () => {
  assert.match(campaigns, /once_per_device/);
  assert.match(campaigns, /once_per_day/);
  assert.match(campaigns, /once_per_app_open/);
  assert.match(campaigns, /markShown\(activeCampaign\)/);
  assert.match(admin, /বাংলাদেশ সময় · UTC\+06:00/);
  assert.match(admin, /toDhakaDateTimeInput\(new Date\(\)\)/);
  assert.match(css, /platform-datetime-control input/);
  assert.match(migration, /once_per_device/);
  assert.doesNotMatch(migration, /notice_impressions|display_count|impression_log/i);
});
