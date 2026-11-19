import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const stylesheet = path.join(process.cwd(), 'src/styles/run81-theme-stability-and-compact-auth.css');
const main = path.join(process.cwd(), 'src/main.jsx');

test('Run81 compact-auth stylesheet exists at the imported project path', () => {
  assert.ok(fs.existsSync(stylesheet), `Missing stylesheet: ${stylesheet}`);
  assert.ok(fs.statSync(stylesheet).size > 0, 'Run81 stylesheet must not be empty');
});

test('main.jsx import resolves to the Run81 stylesheet', () => {
  const source = fs.readFileSync(main, 'utf8');
  assert.match(source, /\.\/styles\/run81-theme-stability-and-compact-auth\.css/);
});

test('Run81 stylesheet only targets compact auth layout and does not alter app flows', () => {
  const css = fs.readFileSync(stylesheet, 'utf8');
  assert.match(css, /\.auth-page/);
  assert.match(css, /\.auth-shell-compact/);
  assert.doesNotMatch(css, /\.dashboard-page|\.profile-page|\.about-page|\.onboarding-page|\.hostel-invite-page/);
  assert.doesNotMatch(css, /display\s*:\s*none[^}]*!important/i);
});
