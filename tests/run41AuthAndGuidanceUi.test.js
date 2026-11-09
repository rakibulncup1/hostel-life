import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const auth = read('src/features/auth/AuthPage.jsx');
const infoPanel = read('src/components/InfoPanel.jsx');
const uiCss = read('src/styles/ui-polish-v41.css');
const main = read('src/main.jsx');

 test('verification step is minimal and shows the destination email with a single code field', () => {
  assert.match(auth, /minimal=\{otpStep\}/);
  assert.match(auth, /title=\{otpStep \? 'ইমেইল যাচাই'/);
  assert.match(auth, /className="auth-verification-email"/);
  assert.match(auth, /<strong>\{email\}<\/strong>/);
  assert.match(auth, /className="auth-otp-input"/);
  assert.match(auth, /inputMode="numeric"/);
  assert.match(auth, /autoComplete="one-time-code"/);
  assert.match(auth, /verificationCode\.length !== 6/);
  assert.match(auth, /className="auth-otp-resend"/);
  assert.match(auth, /className="text-button auth-otp-edit"/);
  assert.match(auth, /!otpStep && <AuthSwitch current="register" \/>/);
});

test('verification state does not render registration identity, email or password inputs', () => {
  const otpBranchStart = auth.indexOf('{otpStep ? (');
  const regularBranchStart = auth.indexOf(') : (', otpBranchStart);
  const otpBranch = auth.slice(otpBranchStart, regularBranchStart);
  assert.ok(otpBranchStart >= 0 && regularBranchStart > otpBranchStart);
  assert.match(otpBranch, /auth-verification-email/);
  assert.match(otpBranch, /auth-otp-input/);
  assert.doesNotMatch(otpBranch, /autoComplete="(?:name|tel|email|new-password)"/);
  assert.equal((otpBranch.match(/<input\b/g) || []).length, 1);
});

test('shared InfoPanel is exposed as an accessible note and all variants use the global polish stylesheet', () => {
  assert.match(infoPanel, /role="note"/);
  assert.match(infoPanel, /data-tone=\{tone\}/);
  assert.match(uiCss, /\.info-panel-warning/);
  assert.match(uiCss, /\.info-panel-success/);
  assert.match(uiCss, /\.form-hint/);
  assert.match(uiCss, /\.meal-policy-note/);
  assert.match(uiCss, /\.platform-form-help/);
});

test('UI polish stylesheet loads after existing styles and leaves data services untouched', () => {
  assert.match(main, /styles\/ui-polish-v41\.css/);
  assert.ok(main.indexOf("styles/production-flow-finishing.css") < main.indexOf("styles/ui-polish-v41.css"));
  assert.doesNotMatch(uiCss, /fetch\(|\.rpc\(|\.from\(|localStorage|sessionStorage/);
});

test('auth branding uses selected theme tokens and responsive mobile layout', () => {
  assert.match(uiCss, /var\(--primary-soft\)/);
  assert.match(uiCss, /var\(--surface\)/);
  assert.match(uiCss, /@media \(max-width: 849px\)/);
  assert.match(uiCss, /@media \(max-width: 560px\)/);
  assert.match(uiCss, /auth-brand-lockup/);
  assert.match(uiCss, /auth-brand-highlight/);
});
