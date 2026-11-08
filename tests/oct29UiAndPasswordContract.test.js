import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('forced password success uses the monitored fresh sign-in service instead of stale refreshSession', () => {
  const source = read('src/features/auth/ForcedPasswordChange.jsx');
  const authService = read('src/services/authService.js');
  assert.match(source, /verifyPassword\(\{ email, password \}\)/);
  assert.match(authService, /export async function verifyPassword\(\{ email, password \}\)[\s\S]*?return signIn\(\{ email, password, trackSuccessfulLogin: false \}\)/);
  assert.doesNotMatch(source, /auth\.refreshSession\(/);
  assert.match(source, /reloginNeeded/);
  assert.match(source, /12000/);
});

test('unified branding is wired into auth, platform and printed reports', () => {
  assert.match(read('src/features/auth/AuthPage.jsx'), /<BrandMark size=\{64\}/);
  assert.match(read('src/features/platform/SuperAdminPage.jsx'), /<BrandMark size=\{49\}/);
  assert.match(read('src/services/reportService.js'), /hostel-life-mark\.svg/);
  assert.ok(existsSync(new URL('../public/icons/hostel-life-mark.svg', import.meta.url)));
});

test('UI refresh has explicit phone and tablet responsive rules', () => {
  const css = read('src/styles/ui-refresh.css');
  assert.match(css, /@media\(max-width:849px\)/);
  assert.match(css, /@media\(max-width:480px\)/);
  assert.match(css, /\.platform-page \.platform-tabs button\.active/);
});
