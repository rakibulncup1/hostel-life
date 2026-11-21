import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const auth = read('src/features/auth/AuthPage.jsx');
const callback = read('src/features/auth/GoogleOAuthCallbackPage.jsx');
const about = read('public/about.html');
const aboutCss = read('public/landing-assets/run98-about-header-hero.css');
const appCss = read('src/styles/run98-professional-visual-polish.css');
const run105Css = read('src/styles/run105-requested-ui-polish.css');
const main = read('src/main.jsx');
const download = read('src/features/menu/AppDownloadPage.jsx');
const menuPages = read('src/features/menu/MenuPages.jsx');
const dashboard = read('src/features/dashboard/DashboardPage.jsx');
const english = read('public/app-english-translations.js');

test('Google CTA fills the available auth width and uses a highlighted official theme', () => {
  assert.match(auth, /Math\.min\(400,/);
  assert.match(auth, /theme: 'filled_blue'/);
  assert.match(appCss, /\.auth-page \.google-signin-section\s*\{[^}]*width:\s*min\(100%, 400px\)/s);
  assert.match(appCss, /\.auth-page \.google-signin-consent\s*\{[^}]*width:\s*100%/s);
  assert.match(appCss, /\.auth-page \.google-signin-sdk-slot\s*\{[^}]*min-height:\s*52px/s);
});

test('Desktop auth welcome/title area receives a subtle panel without changing mobile form layout', () => {
  assert.match(appCss, /@media \(min-width: 761px\)[\s\S]*?\.auth-form-panel \.auth-header/);
  assert.match(appCss, /\.auth-header > div\s*\{[^}]*border-radius:\s*14px/);
  assert.match(appCss, /@media \(max-width: 760px\)/);
  assert.match(auth, /আবারও স্বাগতম/);
  assert.match(auth, /নতুন যাত্রা শুরু হোক/);
});

test('Google verification screen shows a minimal progress indicator and respects reduced motion', () => {
  assert.match(callback, /google-oauth-callback-checking/);
  assert.match(callback, /google-oauth-progress-track/);
  assert.match(appCss, /\.google-oauth-progress-track\s*\{/);
  assert.match(appCss, /prefers-reduced-motion:\s*reduce/);
});

test('About mobile header exposes the app-download action in the top action row', () => {
  assert.match(about, /class="btn btn-download nav-download" href="\/app\/menu\/app-download"/);
  assert.match(aboutCss, /@media \(max-width: 860px\)[\s\S]*?\.nav-actions \.nav-download\s*\{[^}]*display:\s*inline-flex !important/s);
  assert.match(aboutCss, /grid-template-columns:\s*48px minmax\(0, \.9fr\) minmax\(0, 1fr\) minmax\(0, \.78fr\)/);
});

test('About hero removes the glowing eyebrow and presents readable light/dark copy surfaces', () => {
  const hero = about.slice(about.indexOf('<section class="hero">'), about.indexOf('<section class="proof-band"'));
  assert.doesNotMatch(hero, /about\.hero\.eyebrow|মেসের দৈনন্দিন ব্যবস্থাপনা/);
  assert.match(aboutCss, /\.hero-copy-column h1\s*\{[^}]*color:\s*var\(--ink\)/s);
  assert.match(aboutCss, /\.hero-copy-column \.hero-copy\s*\{[^}]*color:\s*var\(--muted\)/s);
  assert.match(aboutCss, /:root\[data-theme="dark"\] \.about-page \.hero-copy-column h1/);
});

test('About feature ribbon uses balanced desktop cards and a compact mobile stack', () => {
  assert.match(aboutCss, /\.proof-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/s);
  assert.match(aboutCss, /\.proof-item\s*\{[^}]*min-height:\s*86px/);
  assert.match(aboutCss, /@media \(max-width: 760px\)[\s\S]*?\.proof-grid\s*\{[^}]*grid-template-columns:\s*1fr/s);
});

test('App download header uses the same centered card treatment as the All Members page', () => {
  assert.match(download, /className="page-title-row menu-page-title card menu-page-intro-card app-download-menu-intro"/);
  assert.match(run105Css, /app-download-menu-intro[\s\S]*?background:\s*var\(--surface-2\) !important/);
  assert.match(run105Css, /app-download-single-card \{ width: min\(100%, 620px\)/);
});

test('Market-spending ranking title is neutral and has an English translation', () => {
  assert.match(menuPages, /shopper \? 'বাজারের মোট খরচ অনুযায়ী'/);
  assert.doesNotMatch(menuPages, /বাজারের সেরা ক্রেতারা/);
  assert.match(english, /"বাজারের মোট খরচ অনুযায়ী":\s*"Members by total market spending"/);
});

test('Member detail summary metrics are balanced across desktop and mobile', () => {
  assert.match(dashboard, /member-period-summary-grid/);
  assert.match(appCss, /\.member-period-summary-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\) !important/s);
  assert.match(appCss, /@media \(max-width: 760px\)[\s\S]*?\.member-period-summary-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\) !important/s);
  assert.match(appCss, /grid-auto-rows:\s*minmax\(82px, auto\)/);
  assert.match(appCss, /grid-auto-rows:\s*minmax\(76px, auto\)/);
});

test('Run98 stylesheets are loaded through the correct app and public-page entry points', () => {
  assert.match(main, /import '\.\/styles\/run98-professional-visual-polish\.css'/);
  assert.match(about, /href="\/landing-assets\/run98-about-header-hero\.css"/);
  assert.ok(fs.existsSync(path.join(root, 'src/styles/run98-professional-visual-polish.css')));
  assert.ok(fs.existsSync(path.join(root, 'public/landing-assets/run98-about-header-hero.css')));
});

test('New selectors stay scoped to the requested pages and feature components', () => {
  assert.match(appCss, /\.auth-page/);
  assert.match(appCss, /\.app-download-page/);
  assert.match(appCss, /\.dashboard-reimagined \.member-period-detail-modal/);
  assert.match(aboutCss, /\.about-page/);
  assert.doesNotMatch(aboutCss, /\.dashboard-reimagined|\.profile-page|\.dining-page/);
});
