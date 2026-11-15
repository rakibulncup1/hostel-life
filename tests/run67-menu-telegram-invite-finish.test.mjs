import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const app = read('src/app/App.jsx');
const invite = read('src/features/invites/HostelInvitePage.jsx');
const telegram = read('src/features/telegram/TelegramConnectionPage.jsx');
const onboarding = read('src/features/onboarding/OnboardingPage.jsx');
const styles = read('src/styles/run67-menu-telegram-invite-finish.css');
const menu = read('src/features/menu/MenuPages.jsx');
const main = read('src/main.jsx');
const html = read('index.html');
const manifest = JSON.parse(read('public/manifest.webmanifest'));
const sw = read('public/service-worker.js');
const theme = read('src/app/theme.js');

function section(source, start, end) {
  const a = source.indexOf(start);
  assert.notEqual(a, -1, `missing start ${start}`);
  const b = source.indexOf(end, a);
  assert.ok(b > a, `missing end ${end}`);
  return source.slice(a, b);
}

test('How-to timing header is visually separated from the four timing cards', () => {
  assert.match(menu, /সময় মনে রাখুন/);
  assert.match(styles, /\.howto-page \.howto-timing-heading[\s\S]*?padding: 1px 0 17px/);
  assert.match(styles, /\.howto-page \.howto-time-grid[\s\S]*?gap: 12px/);
  assert.match(styles, /\.howto-page \.howto-time-card[\s\S]*?border-radius: 15px/);
  assert.match(styles, /@media \(max-width: 380px\)[\s\S]*?\.howto-page \.howto-time-grid \{ grid-template-columns: minmax\(0, 1fr\)/);
});

test('Telegram page removes the redundant subtitle and provides a desktop two-column layout with mobile fallback', () => {
  const header = section(telegram, 'const pageIntro = (', ');\n\n  if (loading)');
  assert.match(header, /<h1>টেলিগ্রাম সংযোগ<\/h1>/);
  assert.doesNotMatch(header, /টেলিগ্রাম সংযোগ চালু করে মেসের বিজ্ঞপ্তি পান/);
  assert.match(styles, /\.telegram-page \.telegram-connection-card[\s\S]*?grid-template-columns: minmax\(0, \.88fr\) minmax\(0, 1\.12fr\)/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.telegram-page \.telegram-connection-card[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
});

test('Join-code field removes the repeated visible label but preserves its accessible name', () => {
  const join = section(onboarding, '<form className="form-stack onboarding-entry-form" onSubmit={join}>', '</form>');
  assert.match(join, /className="visually-hidden">যোগদানের কোড/);
  assert.match(join, /aria-label="যোগদানের কোড"/);
  assert.match(join, /placeholder="A1B2C3D4E5F6"/);
});

test('Invite route is public and renders before the generic auth redirect while request creation remains authenticated', () => {
  const route = app.indexOf("if (pathname.startsWith('/invite/')) {");
  const authLoading = app.indexOf('if (auth.authLoading) return withPublicCommunications(<LoadingSpinner label="সেশন যাচাই হচ্ছে..." />);');
  const unauthenticated = app.indexOf('if (!auth.isAuthenticated) return withPublicCommunications(<AuthPage pathname="/auth/login" />);');
  assert.ok(route >= 0 && route < authLoading && authLoading < unauthenticated);
  assert.match(invite, /setPendingHostelLinkToken\(token\)/);
  assert.match(invite, /createHostelJoinRequestFromInvite\(token, requestNote\)/);
  assert.match(invite, /if \(!auth\.isAuthenticated \|\| auth\.authLoading \|\| !auth\.identityReady \|\| auth\.identityLoading\)/);
  assert.match(invite, /className="hostel-invite-page hostel-invite-page-loading"/);
  assert.match(invite, /আমন্ত্রণ যাচাই হচ্ছে/);
  assert.match(styles, /\.hostel-invite-loading-card[\s\S]*?background: color-mix\(in srgb, var\(--surface\) 96%, transparent\)/);
});

test('Shared invite token remains fragment-based and invite navigation is never cached', () => {
  assert.match(app, /pathname === '\/invite'[\s\S]*?window\.location\.hash/);
  assert.match(read('src/features/manager/ManagerPages.jsx'), /\/invite#\$\{result\.token\}/);
  assert.match(sw, /url\.pathname === '\/invite'[\s\S]*?fetch\(request, \{ cache: 'no-store' \}\)/);
  assert.match(sw, /url\.pathname\.startsWith\('\/invite\/'\)[\s\S]*?fetch\(request, \{ cache: 'no-store' \}\)/);
});

test('First paint and installed PWA use the modern light surface; explicit later theme selection remains supported', () => {
  assert.match(html, /<meta name="theme-color" content="#f4f8f5"\s*\/>/);
  assert.match(html, /html, body, #root \{ min-height: 100%; background: #f4f8f5; \}/);
  assert.equal(manifest.theme_color, '#f4f8f5');
  assert.match(theme, /themeMeta\.setAttribute\('content', browserThemeColor\)/);
  assert.match(theme, /effective === 'dark' \? '#09100d'/);
  assert.match(sw, /hostel-life-shell-v20/);
  assert.match(main, /run67-menu-telegram-invite-finish\.css/);
});
