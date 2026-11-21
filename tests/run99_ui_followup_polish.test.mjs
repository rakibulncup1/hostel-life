import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const appCss = read('src/styles/run99-auth-member-followup.css');
const run101Css = read('src/styles/run101-ui-completion.css');
const aboutCss = read('public/landing-assets/run99-about-hero-alignment.css');
const auth = read('src/features/auth/AuthPage.jsx');
const translations = read('public/app-english-translations.js');
const main = read('src/main.jsx');
const aboutHtml = read('public/about.html');

test('Run99 app stylesheet is loaded after Run98 and exists', () => {
  assert.match(main, /import\s+['"]\.\/styles\/run99-auth-member-followup\.css['"]/);
  assert.ok(fs.existsSync(path.join(root, 'src/styles/run99-auth-member-followup.css')));
});

test('Run99 About stylesheet is linked and exists', () => {
  assert.match(aboutHtml, /href=["']\/landing-assets\/run99-about-hero-alignment\.css["']/);
  assert.ok(fs.existsSync(path.join(root, 'public/landing-assets/run99-about-hero-alignment.css')));
});

test('About desktop hero columns align at the top and stretch evenly', () => {
  assert.match(aboutCss, /@media\s*\(min-width:\s*761px\)[\s\S]*?\.about-page\s+\.hero-grid\s*\{[^}]*align-items:\s*stretch/);
  assert.match(aboutCss, /\.about-page\s+\.hero-gallery\s*\{[^}]*padding-top:\s*0/);
  assert.match(aboutCss, /\.about-page\s+\.hero-copy-column\s*\{[^}]*display:\s*flex/);
});

test('About supporting copy receives a coloured, readable panel in light and dark themes', () => {
  assert.match(aboutCss, /\.about-page\s+\.hero-copy-column\s+\.hero-copy\s*\{[^}]*background:\s*linear-gradient/);
  assert.match(aboutCss, /:root\[data-theme="dark"\][\s\S]*?\.about-page\s+\.hero-copy-column\s+\.hero-copy/);
});

test('About desktop feature points stack as three full-width rows while mobile keeps its previous flow', () => {
  assert.match(aboutCss, /@media\s*\(min-width:\s*761px\)[\s\S]*?\.about-page\s+\.hero-copy-column\s+\.hero-points\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(aboutCss, /@media\s*\(max-width:\s*760px\)/);
});

test('Auth desktop welcome and registration headings are centered', () => {
  assert.match(appCss, /@media\s*\(min-width:\s*761px\)[\s\S]*?\.auth-form-panel\s+\.auth-header\s*\{[^}]*text-align:\s*center/);
});

test('Registration consent is normalized to the login consent dimensions', () => {
  assert.match(appCss, /\.auth-shell-register[^}]*\.auth-combined-consent|\.auth-shell-register[^\{]*\.auth-combined-consent/);
  assert.match(appCss, /\.auth-combined-consent\s*\{[^}]*width:\s*min\(100%,\s*400px\)[^}]*padding:\s*10px\s+13px/);
  assert.match(appCss, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.auth-combined-consent\s*\{[^}]*padding:\s*9px\s+11px/);
});

test('Google placeholder colours match the configured official GIS themes', () => {
  assert.match(auth, /theme:\s*'outline'/);
  assert.match(run101Css, /\.auth-page \.google-signin-button,[\s\S]*?background: #fff !important/);
  assert.match(run101Css, /:root\[data-theme="dark"\][\s\S]*?\.auth-page \.google-signin-button[\s\S]*?background: #f8f9fa !important/);
});

test('About, Privacy and Terms footer links are visibly highlighted and responsive', () => {
  assert.match(appCss, /\.auth-page\s+\.auth-shell:not\(\.auth-shell-compact\):not\(\.auth-shell-verification\)\s+\.auth-form-panel\s*>\s*\.auth-legal-links\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(3,/);
  assert.match(appCss, /\.auth-page\s+\.auth-shell:not\(\.auth-shell-compact\):not\(\.auth-shell-verification\)\s+\.auth-form-panel\s*>\s*\.auth-legal-links\s+a\s*\{[^}]*min-height:\s*40px[^}]*background:/);
  assert.match(appCss, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.auth-page\s+\.auth-shell:not\(\.auth-shell-compact\):not\(\.auth-shell-verification\)\s+\.auth-form-panel\s*>\s*\.auth-legal-links\s+a/);
});

test('Registration permission-code help text is removed without changing required validation', () => {
  assert.doesNotMatch(auth, /নতুন অ্যাকাউন্ট খোলার অনুমতি যাচাই করতে কোডটি লাগবে/);
  assert.ok(auth.includes('{registrationCodeRequired && <label className="field-label"><span>অনুমতি কোড</span><input value={permissionCode}'));
  assert.match(translations, /"হোস্টেল লাইফের দেওয়া কোড":\s*"Code provided by Hostel Life"/);
  assert.doesNotMatch(translations, /"Super Admin-এর দেওয়া কোড"/);
});

test('Six member summary cards are larger on desktop and mobile', () => {
  assert.match(appCss, /\.member-period-summary-grid\s*\{[^}]*grid-auto-rows:\s*minmax\(94px,\s*auto\)/);
  assert.match(appCss, /\.member-period-summary-grid\s*>\s*\.metric\s*\{[^}]*min-height:\s*94px/);
  assert.match(appCss, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.member-period-summary-grid\s*\{[^}]*grid-auto-rows:\s*minmax\(88px,\s*auto\)/);
});
