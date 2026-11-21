import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const about = read('public/about.html');
const aboutCss = read('public/landing-assets/run101-about-public-polish.css');
const legalCss = read('public/landing-assets/run101-legal-policy-polish.css');
const auth = read('src/features/auth/AuthPage.jsx');
const appCss = read('src/styles/run101-ui-completion.css');
const onboarding = read('src/features/onboarding/OnboardingPage.jsx');
const language = read('public/language-runtime.js');
const privacy = read('public/privacy-policy.html');
const terms = read('public/terms-of-service.html');

test('01 — English About feature rows stay vertically stacked like Bangla', () => {
  assert.match(about, /run83-about-english-feature-wrap\.css/);
  assert.match(aboutCss, /:root\[data-language="en"\] \.about-page \.hero-copy-column \.hero-points[\s\S]*?grid-template-columns: minmax\(0, 1fr\) !important/);
});

test('02 — About mobile header keeps all four actions in one compact responsive row', () => {
  assert.match(aboutCss, /\.about-page \.nav-actions[\s\S]*?grid-template-columns: minmax\(34px, \.78fr\) repeat\(3, minmax\(0, 1fr\)\)/);
});

test('03 — Mobile About headline uses a larger balanced type scale', () => {
  assert.match(aboutCss, /\.about-page \.hero-copy-column h1[\s\S]*?font-size: clamp\(31px, 8vw, 39px\)/);
});

test('04 — About hero supporting copy changes text colour only', () => {
  assert.match(aboutCss, /\.about-page \.hero-copy-column \.hero-copy \{ color: #315e4b; \}/);
  assert.doesNotMatch(aboutCss, /\.about-page \.hero-copy-column \.hero-copy \{[^}]*background:/);
});

test('05 — Desktop gap before About feature section is reduced but remains responsive', () => {
  assert.match(aboutCss, /#features\.section \{ padding-top: clamp\(54px, 5\.2vw, 68px\); \}/);
});

test('06 — About explanatory copy uses readable text colours in both themes', () => {
  assert.match(aboutCss, /\.about-page \.feature-copy p,[\s\S]*?\.about-page \.workflow-card p,[\s\S]*?\.about-page \.showcase-copy p/);
  assert.match(aboutCss, /:root\[data-theme="dark"\] \.about-page \.feature-meta/);
});

test('07 — About sample captions and tags are text-only without decorative dots or pill fills', () => {
  assert.match(aboutCss, /\.about-page \.feature-meta i \{ display: none !important; \}/);
  assert.match(aboutCss, /\.about-page \.feature-tag,[\s\S]*?background: transparent/);
});

test('08 — English About typography gets subtle kerning/letter-spacing refinement', () => {
  assert.match(aboutCss, /:root\[data-language="en"\] \.about-page \.hero-copy-column h1[\s\S]*?letter-spacing: -\.022em/);
});

test('09 — Public policy copyright is split into leaf text nodes to prevent duplicate translation', () => {
  for (const html of [privacy, terms, about]) {
    assert.match(html, /common\.copyright\.prefix/);
    assert.match(html, /common\.copyright\.suffix/);
    assert.doesNotMatch(html, /data-i18n-key="common\.copyright"[^>]*>[\s\S]*?<span id="copyright-year"/);
  }
  assert.match(language, /'common\.copyright\.prefix': 'Copyright © '/);
});

test('10 — Public legal intro is visually highlighted and terms intro has English copy', () => {
  assert.match(privacy, /run101-legal-policy-polish\.css/);
  assert.match(terms, /run101-legal-policy-polish\.css/);
  assert.match(legalCss, /\.legal-document \.legal-intro[\s\S]*?background: linear-gradient/);
  assert.match(language, /'terms\.intro': 'Hostel Life helps organise/);
});

test('11 — Mobile Login trims branding/header/form vertical space and hides redundant subtitle', () => {
  assert.match(auth, /auth-shell-login/);
  assert.match(appCss, /\.auth-shell-login:not\(\.auth-shell-compact\) \.auth-header p,[\s\S]*?display: none !important/);
  assert.match(appCss, /\.auth-shell-login:not\(\.auth-shell-compact\) \.field-label > input[\s\S]*?height: 42px/);
});

test('12 — Mobile Registration mirrors compact Login spacing and keeps password fields stacked', () => {
  assert.match(appCss, /\.auth-shell-register:not\(\.auth-shell-compact\) \.auth-header p/);
  assert.match(appCss, /\.auth-shell-register:not\(\.auth-shell-compact\) \.auth-register-form \{ gap: 10px/);
  assert.match(read('src/styles/run100-final-ui-refinement.css'), /@media \(max-width: 849px\)[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
});

test('13 — Desktop registration consent/Google fill the action width; Google uses the filled blue theme and footer text links', () => {
  assert.match(appCss, /\.auth-shell-register:not\(\.auth-shell-compact\) \.auth-combined-consent,[\s\S]*?width: 100%/);
  assert.match(auth, /theme: 'filled_blue'/);
  assert.match(appCss, /\.auth-form-panel > \.auth-legal-links a[\s\S]*?background: transparent/);
});

test('14 — Join code heading is visually hidden but remains accessible', () => {
  assert.match(onboarding, /className=\{mode === 'join' \? 'visually-hidden' : undefined\}/);
  assert.match(onboarding, /aria-label="যোগদানের কোড"/);
});

test('15 — Successful hostel creation shows a verified first-month badge, not the old inline success note', () => {
  assert.match(onboarding, /creation-success-verification[\s\S]*?প্রথম মাস চালু হয়ে গেছে।/);
  assert.match(appCss, /\.creation-success-verification[\s\S]*?background: linear-gradient/);
  assert.doesNotMatch(onboarding, /initialMonthStatus === 'started' && <div className="inline-success"/);
});
