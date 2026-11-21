import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const runtime = read('public/language-runtime.js');
const about = read('public/about.html');
const privacy = read('public/privacy-policy.html');
const terms = read('public/terms-of-service.html');
const authCss = read('src/styles/run102-auth-compact-translation.css');
const main = read('src/main.jsx');
const authPage = read('src/features/auth/AuthPage.jsx');

test('About management and service overview have explicit English keyed translations', () => {
  for (const key of ['about.management.eyebrow','about.management.title','about.management.description','about.management.requests.title','about.management.requests.description','about.management.menu.title','about.management.menu.description','about.copy.9394758084','about.copy.3eec0c8b85']) {
    assert.match(runtime, new RegExp(`['"]${key.replaceAll('.', '\\.')}['"]\\s*:`));
    assert.match(about, new RegExp(`data-i18n-key="${key.replaceAll('.', '\\.')}"`));
  }
});
test('About sample preview copy includes explicit English key coverage', () => {
  for (const key of ['about.copy.7cbc8fbb54','about.copy.7e4bddf5f8','about.copy.ca0e079d07','about.copy.8f3f11b2f7','about.copy.3bea83a59f','about.copy.73313eb0fa']) assert.match(runtime, new RegExp(key.replaceAll('.', '\\.')));
});
test('Privacy and Terms last-updated labels are language keyed', () => {
  assert.match(privacy, /data-i18n-key="legal\.lastUpdated"/);
  assert.match(terms, /data-i18n-key="legal\.lastUpdated"/);
  assert.match(runtime, /legal\.lastUpdated/);
});
test('Auth subtitles are hidden and vertical controls are compact without changing form logic', () => {
  assert.match(authCss, /auth-header p[\s\S]*display:none/);
  assert.match(authCss, /min-height:40px/);
  assert.match(authCss, /padding-block:18px/);
});
test('Google surface styling does not target or rewrite Google iframe internals', () => {
  assert.match(authCss, /\.google-signin-widget/);
  assert.match(authPage, /logo_alignment:\s*'center'/);
  assert.match(authPage, /locale:\s*english \? 'en' : 'bn'/);
  assert.doesNotMatch(authCss.replace(/\/\*[\s\S]*?\*\//g, ''), /iframe|\.google-signin-sdk-slot\s*\*/);
});
test('New auth stylesheet is imported once', () => {
  assert.equal((main.match(/run102-auth-compact-translation\.css/g) || []).length, 1);
});

test('Every keyed label in the management showcase has an explicit English translation', () => {
  const start = about.indexOf('id="management-showcase"');
  const end = about.indexOf('<section class="section section-tint"', start);
  const section = about.slice(start, end);
  const keys = [...section.matchAll(/data-i18n-key="([^"]+)"/g)].map((m) => m[1]);
  for (const key of new Set(keys)) assert.ok(runtime.includes(`'${key}':`) || runtime.includes(`'${key}' :`), `Missing English key: ${key}`);
});
