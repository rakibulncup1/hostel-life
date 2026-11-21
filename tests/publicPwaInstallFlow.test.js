import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const about = read('public/about.html');
const installScript = read('public/landing-assets/public-install.js');
const downloadPage = read('src/features/menu/AppDownloadPage.jsx');

test('all public About download links use the shared in-app App Download page', () => {
  assert.match(about, /landing-assets\/public-install\.js/);
  const links = about.match(/<a[^>]*href="\/app\/menu\/app-download"[^>]*data-pwa-install-link/g) || [];
  assert.ok(links.length >= 3);
  assert.match(installScript, /No click interception/);
  assert.doesNotMatch(installScript, /beforeinstallprompt|preventDefault\(\)|installEvent\.prompt/);
  assert.match(downloadPage, /useInstallPromptContext/);
  assert.match(downloadPage, /canInstall \? \(/);
  assert.match(downloadPage, /install\(\)/);
});

test('unsupported PWA platforms receive one concise platform-specific fallback instead of a long checklist', () => {
  assert.match(downloadPage, /iPhone বা iPad-এ ইনস্টল/);
  assert.match(downloadPage, /Android-এ ইনস্টল/);
  assert.match(downloadPage, /কম্পিউটারে ইনস্টল/);
  assert.match(downloadPage, /Safari-এর Share মেনু থেকে/);
  assert.doesNotMatch(downloadPage, /guide\.steps|<ol>/);
});
