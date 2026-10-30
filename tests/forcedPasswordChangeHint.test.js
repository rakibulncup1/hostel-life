import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/features/auth/ForcedPasswordChange.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles/ui-refresh.css', import.meta.url), 'utf8');

test('temporary-password replacement visibly explains the 12-character minimum', () => {
  assert.match(source, /নতুন পাসওয়ার্ড কমপক্ষে ১২ অক্ষরের হতে হবে/);
  assert.match(source, /minLength=\{12\}/);
  assert.match(source, /password\.length<\/12|password\.length}\/12/);
});

test('temporary-password button remains disabled until both entries meet the rule and match', () => {
  assert.match(source, /disabled=\{busy \|\| done \|\| !passwordLongEnough \|\| !passwordsMatch\}/);
  assert.match(source, /দুটি পাসওয়ার্ড এখনো মেলেনি/);
});

test('visible hint has responsive styles without changing the password policy', () => {
  assert.match(css, /\.forced-password-length-hint/);
  assert.match(css, /\.forced-password-change \.forced-password-match-hint/);
});
