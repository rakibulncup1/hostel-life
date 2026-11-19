import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const entryCss = read('src/styles/run87-public-entry-compact.css');
const aboutCss = read('public/landing-assets/run87-about-header.css');
const main = read('src/main.jsx');
const about = read('public/about.html');
const auth = read('src/features/auth/AuthPage.jsx');
const onboarding = read('src/features/onboarding/OnboardingPage.jsx');
const invite = read('src/features/invites/HostelInvitePage.jsx');

test('Run87 entry stylesheet is loaded after the existing Run86 public-entry styles', () => {
  assert.match(main, /import '\.\/styles\/run86-public-entry-compact\.css';\s*import '\.\/styles\/run87-public-entry-compact\.css';/);
});

test('Run87 removes only the repeated standard-auth badge and keeps OTP verification marker', () => {
  assert.match(entryCss, /\.auth-page:not\(\.auth-page-verification\) \.auth-form-toolbar\s*\{\s*display:\s*none/);
  assert.match(auth, /minimal \? 'ইমেইল যাচাই' : 'নিরাপদ অ্যাকাউন্ট'/);
  assert.match(entryCss, /auth-page-verification/);
});

test('Run87 removes the redundant onboarding account-setup badge without changing onboarding markup', () => {
  assert.match(entryCss, /\.onboarding-page \.onboarding-topbar\s*\{\s*display:\s*none/);
  assert.match(onboarding, /function OnboardingTopbar\(\)/);
  assert.match(onboarding, /className="onboarding-account-setup-chip"/);
});

test('Run87 removes only the duplicate invite title badge while preserving the defer action', () => {
  assert.match(entryCss, /\.hostel-invite-page \.hostel-invite-topbar > span\s*\{\s*display:\s*none/);
  assert.match(invite, /className="hostel-invite-exit"/);
  assert.match(invite, /className="hostel-invite-security-note"/);
});

test('Desktop Login is narrowed without fixed height or hidden overflow', () => {
  assert.match(entryCss, /\.auth-shell:not\(\.auth-shell-compact\):not\(\.auth-shell-register\)\s*\{[^}]*width:\s*min\(760px/);
  assert.match(entryCss, /grid-template-columns:\s*minmax\(0, \.76fr\) minmax\(0, 1\.24fr\)/);
  assert.doesNotMatch(entryCss, /\.auth-shell:not\(\.auth-shell-compact\)[^{]*\{[^}]*overflow:\s*hidden/);
});

test('Desktop Registration remains wider than Login but is compact and preserves consent', () => {
  assert.match(entryCss, /\.auth-shell-register:not\(\.auth-shell-compact\)\s*\{[^}]*width:\s*min\(840px/);
  assert.match(entryCss, /\.auth-shell-register:not\(\.auth-shell-compact\) \.auth-legal-consent/);
  assert.match(auth, /className="auth-legal-consent auth-combined-consent"/);
});

test('Forgot Password has a compact rectangular desktop layout with both columns retained', () => {
  assert.match(entryCss, /:has\(\.password-reset-policy\)\s*\{\s*width:\s*min\(680px/);
  assert.match(entryCss, /:has\(\.password-reset-policy\) \.form-stack\s*\{[^}]*grid-template-columns:\s*minmax\(0, \.92fr\) minmax\(0, 1\.08fr\)/);
  assert.match(auth, /className="password-reset-policy"/);
});

test('Reset Password is narrower than the Forgot Password policy layout', () => {
  assert.match(entryCss, /:not\(:has\(\.password-reset-policy\)\)\s*\{\s*width:\s*min\(420px/);
});

test('Desktop onboarding and post-creation success screens use compact widths', () => {
  assert.match(entryCss, /onboarding-shell:not\(\.onboarding-shell-success\)\s*\{\s*width:\s*min\(690px/);
  assert.match(entryCss, /onboarding-shell-success\s*\{\s*width:\s*min\(520px/);
  assert.match(onboarding, /onboarding-shell-success/);
});

test('Desktop invite/join page is compact and keeps request/status elements present', () => {
  assert.match(entryCss, /hostel-invite-card\s*\{\s*width:\s*min\(490px/);
  assert.match(invite, /createHostelJoinRequestFromInvite/);
  assert.match(invite, /hostel-invite-status/);
});

test('Public-entry brand styling uses neutral theme surfaces rather than a green-only panel', () => {
  assert.match(entryCss, /background:\s*color-mix\(in srgb, var\(--surface-2\) 62%, var\(--surface\)\)/);
  assert.match(entryCss, /:root\[data-theme="dark"\] \.auth-page/);
  assert.match(entryCss, /background:\s*#303941/);
});

test('The About header stylesheet is loaded only by the About document', () => {
  assert.match(about, /href="\/landing-assets\/run87-about-header\.css"/);
  assert.match(aboutCss, /^\/\* Run87 — About header refinement only/m);
  assert.doesNotMatch(main, /run87-about-header/);
});

test('Mobile About header keeps the Hostel Life wordmark beside the logo', () => {
  assert.match(aboutCss, /\.about-page \.brand\s*\{[^}]*font-size:\s*17px/);
  assert.doesNotMatch(aboutCss, /\.about-page \.brand\s*\{[^}]*font-size:\s*0/);
});

test('Mobile About navigation uses a separate action row and a refined language control', () => {
  assert.match(aboutCss, /grid-template-rows:\s*auto auto/);
  assert.match(aboutCss, /\.about-page \.nav-actions \.public-language-switcher/);
  assert.match(aboutCss, /grid-template-columns:\s*60px minmax\(0, \.9fr\) minmax\(0, 1\.1fr\)/);
  assert.match(about, /href="\/app\/menu\/app-download" data-pwa-install-link data-i18n-key="about\.copy\.3539014022"/);
});

test('Mobile About keeps download available in the hamburger menu after hiding the duplicate top-row action', () => {
  assert.match(aboutCss, /\.about-page \.nav-actions \.nav-download,\s*\.about-page \.public-theme-control-desktop \{ display: none/);
  assert.match(about, /<details class="mobile-menu">[\s\S]*?href="\/app\/menu\/app-download" data-pwa-install-link/);
});

test('Run87 leaves existing auth/onboarding/invite components and business logic untouched', () => {
  assert.match(auth, /requestPasswordReset\(email\)/);
  assert.match(auth, /signIn\(\{ email, password \}\)/);
  assert.match(onboarding, /supabase\.rpc\('start_new_month'/);
  assert.match(invite, /createHostelJoinRequestFromInvite\(token, requestNote\)/);
});
