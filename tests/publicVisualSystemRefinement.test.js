import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const publicPages = [
  'public/about.html',
  'public/privacy-policy.html',
  'public/terms-of-service.html',
];

test('all pre-login public pages remain Bengali-first and no longer expose a language toggle', () => {
  for (const file of publicPages) {
    const html = read(file);
    assert.match(html, /<html lang="bn-BD">/);
    assert.doesNotMatch(html, /language-toggle|public-language\.js/);
    assert.match(html, /public-experience\.css/);
    assert.match(html, /content="#f4f8f5"/);
  }
  assert.equal(fs.existsSync(path.join(root, 'public/landing-assets/public-language.js')), false);
});

test('public experience palette follows the existing in-app light theme', () => {
  const appTheme = read('src/styles/global.css');
  const publicCss = read('public/landing-assets/public-experience.css');
  for (const token of ['--bg: #f4f8f5', '--text: #16211c', '--muted: #68756e', '--line: #dfe9e3', '--primary: #0c8f5b']) {
    assert.ok(appTheme.includes(token), `app theme should contain ${token}`);
  }
  for (const color of ['#f4f8f5', '#16211c', '#68756e', '#dfe9e3', '#0c8f5b', '#08764b']) {
    assert.ok(publicCss.includes(color), `public palette should include ${color}`);
  }
  assert.match(publicCss, /\.hero\s*\{[\s\S]*?background: linear-gradient\(180deg, #f4f8f5 0%, #f8faf8 100%\)/);
  assert.match(publicCss, /\.legal-hero\s*\{[\s\S]*?background: linear-gradient\(180deg, #f4f8f5 0%, #f8faf8 100%\)/);
  assert.match(publicCss, /\.site-footer\s*\{[^}]*background: #fff/s);
  const refinedRules = publicCss.split('Public Experience refinement')[1] || '';
  assert.doesNotMatch(refinedRules, /#101f32|#11243a|#163447|language-toggle|html\[lang="en"\]/);
});

test('legal page structure and seven-section navigation are preserved', () => {
  const privacy = read('public/privacy-policy.html');
  const terms = read('public/terms-of-service.html');
  for (const id of ['information', 'purpose', 'visibility', 'sharing', 'control', 'security', 'age']) {
    assert.match(privacy, new RegExp(`href="#${id}"`));
  }
  for (const id of ['service', 'eligibility', 'account', 'roles', 'responsible', 'records', 'availability']) {
    assert.match(terms, new RegExp(`href="#${id}"`));
  }
  for (const content of [privacy, terms]) {
    assert.match(content, /<h1>/);
    assert.match(content, /legal-document/);
    assert.match(content, /legal-contact/);
  }
});

test('public patch remains presentation-only and retains the existing account destinations', () => {
  for (const file of publicPages) {
    const html = read(file);
    assert.match(html, /href="\/auth\/login"/);
    assert.match(html, /href="\/auth\/register"/);
    assert.doesNotMatch(html, /\.rpc\(|\.from\(/);
  }
});
