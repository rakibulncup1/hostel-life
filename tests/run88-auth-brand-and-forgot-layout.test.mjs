import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'src/styles/run88-auth-brand-and-forgot-layout.css'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8');
const authPage = fs.readFileSync(path.join(root, 'src/features/auth/AuthPage.jsx'), 'utf8');

test('Run88 stylesheet loads after the previous public-entry styling', () => {
  const run87Index = main.lastIndexOf("import './styles/run87-public-entry-compact.css';");
  const run88Index = main.lastIndexOf("import './styles/run88-auth-brand-and-forgot-layout.css';");
  assert.ok(run87Index >= 0, 'Run87 import must remain present');
  assert.ok(run88Index > run87Index, 'Run88 must load after Run87');
});

test('login and registration branding remains scoped to non-compact auth shells', () => {
  assert.match(css, /\.auth-shell:not\(\.auth-shell-compact\).*\.auth-brand-panel/);
  assert.match(authPage, /title === 'একটি অ্যাকাউন্ট তৈরি করুন' \? 'auth-shell-register'/);
  assert.match(css, /\.auth-shell:not\(\.auth-shell-compact\)/);
  assert.doesNotMatch(css, /\.dashboard-page|\.profile-page|\.onboarding-page|\.hostel-invite-page/);
});

test('desktop brand lockup stacks the mark above the wordmark', () => {
  assert.match(css, /\.auth-brand-lockup\s*\{[\s\S]*?flex-direction:\s*column\s*!important/);
  assert.match(css, /\.auth-brand-identity\s*\{[\s\S]*?justify-content:\s*center\s*!important/);
});

test('brand name can wrap and is not forced to remain on one line', () => {
  assert.match(css, /\.auth-brand-name\s*\{[\s\S]*?white-space:\s*normal\s*!important/);
  assert.match(css, /\.auth-brand-name\s*\{[\s\S]*?font-size:\s*clamp\(22px,\s*2vw,\s*26px\)\s*!important/);
});

test('brand column has a compact mark, quote and feature list', () => {
  assert.match(css, /\.auth-brand-mark\s*\{[\s\S]*?flex:\s*0 0 56px\s*!important/);
  assert.match(css, /\.auth-brand-quote\s*\{[\s\S]*?font-size:\s*14px\s*!important/);
  assert.match(css, /\.auth-brand-feature-list\s*\{[\s\S]*?flex-wrap:\s*wrap/);
});

test('forgot-password card is selected by its policy content and excludes OTP verification', () => {
  assert.match(css, /\.auth-shell\.auth-shell-compact:not\(\.auth-shell-verification\):has\(\.password-reset-policy\)/);
  assert.match(css, /\.auth-shell\.auth-shell-compact:not\(\.auth-shell-verification\):has\(\.password-reset-policy\)/);
  assert.match(authPage, /<aside className="password-reset-policy"/);
});

test('forgot-password form uses one vertical column instead of a policy side rail', () => {
  assert.match(css, /\.password-reset-policy\) \.form-stack\s*\{[\s\S]*?display:\s*flex\s*!important;[\s\S]*?flex-direction:\s*column\s*!important/);
  assert.doesNotMatch(css, /password-reset-policy[^\n]*\{[^}]*grid-column:\s*2/);
});

test('policy note follows the form actions and uses the full available width', () => {
  assert.match(css, /\.form-stack > \.primary-button\s*\{[\s\S]*?order:\s*3/);
  assert.match(css, /\.form-stack > \.secondary-button\s*\{[\s\S]*?order:\s*4/);
  assert.match(css, /\.form-stack > \.password-reset-policy\s*\{[\s\S]*?order:\s*5;[\s\S]*?width:\s*100%/);
});

test('forgot-password policy body remains readable at desktop width', () => {
  assert.match(css, /\.password-reset-policy p\s*\{[\s\S]*?font-size:\s*11px;[\s\S]*?line-height:\s*1\.58/);
  assert.match(css, /\.password-reset-policy p\s*\{[\s\S]*?word-break:\s*normal/);
});

test('all Run88 layout changes are desktop-only', () => {
  assert.match(css.trimStart(), /^\/\*[\s\S]*?\*\/\s*@media\s*\(min-width:\s*900px\)/);
  assert.doesNotMatch(css, /@media\s*\(max-width|@media\s*\(min-width:\s*(?:[0-8]\d\d|[1-8]\d\d)/);
});

test('forgot-password React form and policy content remain unchanged', () => {
  assert.match(authPage, /const \{ error \} = await requestPasswordReset\(email\)/);
  assert.match(authPage, /setSent\(true\)/);
  assert.match(authPage, /দিনে সর্বোচ্চ ২ বার/);
  assert.match(authPage, /প্রতি ক্যালেন্ডার মাসে সর্বোচ্চ ৫ বার/);
});

test('Run88 does not add or alter route, authentication, or data logic', () => {
  assert.equal((main.match(/run88-auth-brand-and-forgot-layout\.css/g) || []).length, 1);
  assert.match(authPage, /function LoginForm\(\)/);
  assert.match(authPage, /function RegisterForm\(\)/);
  assert.match(authPage, /function ForgotPasswordForm\(\)/);
});
