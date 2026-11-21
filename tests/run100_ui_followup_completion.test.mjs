import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const auth = read('src/features/auth/AuthPage.jsx');
const appCss = read('src/styles/run100-final-ui-refinement.css');
const aboutCss = read('public/landing-assets/run100-about-desktop-balance.css');
const aboutHtml = read('public/about.html');
const main = read('src/main.jsx');
const dashboard = read('src/features/dashboard/DashboardPage.jsx');
const callback = read('src/features/auth/GoogleOAuthCallbackPage.jsx');
const googleUiCss = read('src/styles/run105-requested-ui-polish.css');

test('Run100 application stylesheet is imported after Run99 and exists', () => {
  assert.match(main, /import\s+['"]\.\/styles\/run100-final-ui-refinement\.css['"]/);
  assert.ok(fs.existsSync(path.join(root, 'src/styles/run100-final-ui-refinement.css')));
});

test('Run100 About stylesheet is linked after Run99 and exists', () => {
  assert.ok(aboutHtml.indexOf('run100-about-desktop-balance.css') > aboutHtml.indexOf('run99-about-hero-alignment.css'));
  assert.ok(fs.existsSync(path.join(root, 'public/landing-assets/run100-about-desktop-balance.css')));
});

test('About desktop left and right hero columns stretch to the same top-aligned grid row', () => {
  assert.match(aboutCss, /@media\s*\(min-width:\s*761px\)[\s\S]*?\.about-page\s+\.hero-grid\s*\{[^}]*align-items:\s*stretch\s*!important/);
  assert.match(aboutCss, /\.about-page\s+\.hero-gallery\s*\{[^}]*padding-top:\s*0\s*!important/);
  assert.match(aboutCss, /\.about-page\s+\.hero-copy-column\s*\{[^}]*display:\s*flex/);
});

test('About information panel no longer has a thick green side accent', () => {
  assert.match(aboutCss, /\.about-page\s+\.hero-copy-column\s+\.hero-copy\s*\{[^}]*border-left:\s*1px\s+solid/);
  assert.match(aboutCss, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.hero-copy\s*\{[^}]*border-left-width:\s*1px/);
  assert.doesNotMatch(aboutCss, /border-left:\s*4px\s+solid/);
});

test('About desktop headline is modestly larger and three feature rows fill remaining column height', () => {
  assert.match(aboutCss, /\.about-page\s+\.hero-copy-column\s+h1\s*\{[^}]*font-size:\s*clamp\(38px,\s*4\.3vw,\s*58px\)/);
  assert.match(aboutCss, /\.about-page\s+\.hero-copy-column\s+\.hero-points\s*\{[^}]*flex:\s*1\s+1\s+auto[^}]*grid-template-rows:\s*repeat\(3,\s*minmax\(66px,\s*1fr\)\)/);
  assert.match(aboutCss, /\.about-page\s+\.hero-copy-column\s+\.hero-points\s*>\s*span\s*\{[^}]*height:\s*100%/);
});

test('Registration password and confirmation fields share one desktop row only', () => {
  assert.match(auth, /className="two-field-grid auth-password-confirm-grid"/);
  assert.match(auth, /auth-password-confirm-grid[\s\S]*?PasswordField value=\{password\}[\s\S]*?PasswordField value=\{confirmPassword\}/);
  assert.match(appCss, /@media\s*\(min-width:\s*850px\)[\s\S]*?auth-password-confirm-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/);
  assert.match(appCss, /@media\s*\(max-width:\s*849px\)[\s\S]*?auth-password-confirm-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test('Desktop login and registration input heights are reduced without affecting compact or verification forms', () => {
  assert.match(appCss, /@media\s*\(min-width:\s*850px\)[\s\S]*?\.auth-shell:not\(\.auth-shell-compact\):not\(\.auth-shell-verification\)[\s\S]*?min-height:\s*44px\s*!important/);
  assert.match(appCss, /\.auth-shell:not\(\.auth-shell-compact\):not\(\.auth-shell-verification\)/);
});

test('Registration consent, placeholder and official Google button share the same 400px action width', () => {
  assert.match(appCss, /\.auth-shell-register[^\{]*\.auth-combined-consent\s*\{[^}]*width:\s*min\(100%,\s*400px\)/);
  assert.match(appCss, /\.auth-shell-register[^\{]*\.google-signin-section\s*\{[^}]*width:\s*min\(100%,\s*400px\)/);
  assert.match(appCss, /\.auth-page\s+\.google-signin-sdk-slot\s*\{[^}]*width:\s*100%\s*!important/);
});

test('Google official button host is no longer constrained to the old 280px width', () => {
  assert.match(appCss, /\.auth-page\s+\.google-signin-sdk-slot\s*\{[^}]*width:\s*100%\s*!important/);
  assert.match(appCss, /\.auth-page\s+\.google-signin-widget\s*\{[^}]*max-width:\s*100%/);
  assert.match(auth, /Math\.max\(200,\s*Math\.min\(400,/);
});

test('Google placeholder and official GIS button use the same colorful blue treatment without opacity shift', () => {
  assert.match(auth, /theme:\s*'filled_blue'/);
  assert.match(appCss, /\.google-signin-button:disabled\s*\{[^}]*opacity:\s*1\s*!important/);
  assert.match(googleUiCss, /background: linear-gradient\(135deg, #4285f4 0%, #2f6fda 58%, #2459b8 100%\) !important/);
  assert.match(googleUiCss, /:root\[data-theme="dark"\][\s\S]*?\.auth-page \.google-signin-button[\s\S]*?background: linear-gradient/);
});

test('Member detail six summary cards have larger desktop and mobile row/card heights', () => {
  assert.match(dashboard, /member-period-summary-grid/);
  assert.match(appCss, /\.member-period-summary-grid\s*\{[^}]*grid-auto-rows:\s*minmax\(112px,\s*auto\)\s*!important/);
  assert.match(appCss, /\.member-period-summary-grid\s*>\s*\.metric\s*\{[^}]*min-height:\s*112px\s*!important/);
  assert.match(appCss, /@media\s*\(max-width:\s*760px\)[\s\S]*?grid-auto-rows:\s*minmax\(104px,\s*auto\)\s*!important/);
});

test('Google verification card fits the viewport without content-box padding overflow', () => {
  assert.match(callback, /google-oauth-callback-checking/);
  assert.match(appCss, /\.google-oauth-callback-page\s*\{[^}]*box-sizing:\s*border-box[^}]*min-height:\s*100svh/);
  assert.match(appCss, /\.google-oauth-callback-card\s*\{[^}]*width:\s*min\(100%,\s*420px\)/);
  assert.match(appCss, /prefers-reduced-motion:\s*reduce/);
});

test('Run100 styles remain scoped to About, Auth, callback and member detail surfaces', () => {
  assert.match(aboutCss, /\.about-page/);
  assert.doesNotMatch(aboutCss, /\.dashboard-reimagined|\.profile-page|\.dining-page/);
  assert.match(appCss, /\.auth-page/);
  assert.match(appCss, /\.google-oauth-callback-page/);
  assert.match(appCss, /\.dashboard-reimagined\s+\.member-period-detail-modal/);
  assert.doesNotMatch(appCss, /\.manager-page|\.super-admin-page|\.dining-page/);
});
