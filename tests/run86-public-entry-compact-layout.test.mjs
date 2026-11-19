import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(path.join(root, relative), 'utf8');

const [main, css, auth, onboarding, invite] = await Promise.all([
  read('src/main.jsx'),
  read('src/styles/run86-public-entry-compact.css'),
  read('src/features/auth/AuthPage.jsx'),
  read('src/features/onboarding/OnboardingPage.jsx'),
  read('src/features/invites/HostelInvitePage.jsx'),
]);

test('Run86 public entry stylesheet is loaded after the previous public/auth refinements', () => {
  assert.match(main, /import\s+['"]\.\/styles\/run86-public-entry-compact\.css['"]/);
  assert.ok(main.indexOf("run81-theme-stability-and-compact-auth.css") < main.indexOf("run86-public-entry-compact.css"));
});

test('desktop Login and Registration retain the split layout with compact bounded widths', () => {
  assert.match(css, /@media\s*\(min-width:\s*900px\)[\s\S]*?\.auth-page \.auth-shell:not\(\.auth-shell-compact\)[\s\S]*?width:\s*min\(900px,/);
  assert.match(css, /\.auth-page \.auth-shell-register:not\(\.auth-shell-compact\)[\s\S]*?width:\s*min\(960px,/);
  assert.match(css, /min-height:\s*0;/);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*\.86fr\)\s+minmax\(0,\s*1\.14fr\)/);
});

test('desktop auth form spacing is reduced without changing form controls or handlers', () => {
  assert.match(css, /\.auth-page \.auth-shell:not\(\.auth-shell-compact\) \.auth-form-panel[\s\S]*?padding:\s*24px 29px 25px/);
  assert.match(auth, /function LoginForm\(\)/);
  assert.match(auth, /function RegisterForm\(\)/);
  assert.match(auth, /signIn\(/);
  assert.match(auth, /signUp\(/);
});

test('Forgot Password receives a horizontal desktop policy layout while reset remains compact', () => {
  assert.match(css, /\.auth-page \.auth-shell-compact:has\(\.password-reset-policy\)[\s\S]*?width:\s*min\(760px,/);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*\.92fr\)\s+minmax\(0,\s*1\.08fr\)/);
  assert.match(css, /\.password-reset-policy[\s\S]*?grid-column:\s*2;/);
  assert.match(auth, /className="password-reset-policy"/);
  assert.match(auth, /requestPasswordReset\(/);
  assert.match(auth, /updatePassword\(/);
});

test('Forgot and Reset mobile layout has one brand lockup; OTP verification is excluded', () => {
  assert.match(auth, /className=\{`auth-brand-panel \$\{minimal \? 'auth-brand-panel-compact' : ''\}`\}/);
  assert.match(auth, /compact && !minimal && <div className="auth-compact-brand"/);
  assert.match(css, /\.auth-page \.auth-shell-compact:not\(\.auth-shell-verification\)\s*>\s*\.auth-brand-panel\s*\{\s*display:\s*none\s*!important;/);
  assert.match(css, /auth-shell-compact:not\(\.auth-shell-verification\)\s*>\s*\.auth-brand-panel/);
  assert.match(auth, /minimal \? 'auth-brand-panel-compact' : ''/);
  assert.match(css, /\.auth-page \.auth-shell-compact:not\(\.auth-shell-verification\) \.auth-compact-brand\s*\{\s*display:\s*flex/);
});

test('Onboarding desktop dimensions are reduced while the success shell keeps its own width', () => {
  assert.match(css, /\.onboarding-page \.onboarding-shell:not\(\.onboarding-shell-success\)\s*\{\s*width:\s*min\(820px,/);
  assert.match(css, /\.onboarding-page \.onboarding-shell:not\(\.onboarding-shell-success\)\s*>\s*\.onboarding-main-card/);
  assert.match(css, /\.onboarding-page \.onboarding-topbar/);
  assert.match(onboarding, /className="onboarding-shell onboarding-shell-success"/);
  assert.match(onboarding, /className="onboarding-brand-header"/);
});

test('Invite-by-link desktop card is compact without changing its request controls', () => {
  assert.match(css, /\.hostel-invite-page \.hostel-invite-card\s*\{\s*width:\s*min\(600px,/);
  assert.match(invite, /createHostelJoinRequestFromInvite\(/);
  assert.match(invite, /className="hostel-invite-card"/);
  assert.match(invite, /hostel-invite-security-note warning/);
});

test('Dark public entry surfaces use a neutral graphite palette scoped to public entry pages', () => {
  assert.match(css, /:root\[data-theme="dark"\] \.auth-page,[\s\S]*?:root\[data-theme="dark"\] \.onboarding-page,[\s\S]*?:root\[data-theme="dark"\] \.hostel-invite-page/);
  assert.match(css, /background:\s*#20262c;/);
  assert.match(css, /background:\s*#293139;/);
  assert.match(css, /\.hostel-invite-security-note:not\(\.warning\)/);
});

test('Run86 contains no route, data, service, or application-shell changes', async () => {
  assert.match(css, /\.auth-page/);
  assert.match(css, /\.onboarding-page/);
  assert.match(css, /\.hostel-invite-page/);
  assert.doesNotMatch(css, /\.dashboard|\.profile-experience|\.app-shell|\.sidebar/);
  const mainImports = main.match(/import\s+['"]\.\/styles\/run86-public-entry-compact\.css['"]/g) || [];
  assert.equal(mainImports.length, 1);
});

test('mobile login/register dimensions are not given new fixed widths or fixed heights', () => {
  const mobileBlock = css.match(/@media\s*\(max-width:\s*899px\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  assert.ok(mobileBlock.length > 0);
  assert.doesNotMatch(mobileBlock, /width:\s*\d+px/);
  assert.doesNotMatch(mobileBlock, /height:\s*\d+px/);
});
