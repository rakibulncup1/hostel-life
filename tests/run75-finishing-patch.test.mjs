import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('Run79 cohesive theme layer loads after all previous app refinement layers', () => {
  const entry = read('src/main.jsx');
  assert.match(entry, /run73-professional-refinement\.css/);
  assert.match(entry, /run74-professional-polish\.css/);
  assert.match(entry, /run78-visual-correction\.css/);
  assert.match(entry, /run79-cohesive-theme-and-layout\.css/);
  assert.ok(entry.indexOf('run79-cohesive-theme-and-layout.css') > entry.indexOf('run78-visual-correction.css'));
});

test('Run75 dark palette is scoped to dark mode and leaves light tokens untouched', () => {
  const css = read('src/styles/run75-finishing.css');
  assert.match(css, /:root\[data-theme="dark"\][\s\S]*?--bg:\s*#171c20/i);
  assert.match(css, /--surface:\s*#232a30/i);
  assert.match(css, /--surface-2:\s*#2d353c/i);
  assert.match(css, /--line:\s*#414c55/i);
  assert.doesNotMatch(css, /:root\s*\{[^}]*--bg\s*:/i);
  assert.doesNotMatch(css, /:root\[data-theme="light"\]/i);
  assert.match(css, /--history-(?:green|blue|amber|coral|violet)-bg:\s*#2b333a/i);
});

test('Run75 English layout rules prevent fixed labels and card rows from colliding', () => {
  const css = read('src/styles/run75-finishing.css');
  assert.match(css, /:root\[data-language="en"\][\s\S]*?min-width:\s*0/);
  assert.match(css, /\.brand-name[\s\S]*?white-space:\s*normal/);
  assert.match(css, /\.history-item-card, \.account-history-row[\s\S]*?minmax\(0,\s*1fr\)/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /@media\s*\(max-width:\s*520px\)/);
});

test('Run75 auth refinement is CSS-only and keeps mobile layouts responsive', () => {
  const css = read('src/styles/run75-finishing.css');
  const authSource = read('src/features/auth/AuthPage.jsx');
  assert.match(css, /\.auth-page \.auth-shell:not\(\.auth-shell-compact\)/);
  assert.match(css, /\.auth-shell-compact/);
  assert.match(css, /\.auth-register-form/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /@media\s*\(max-width:\s*380px\)/);
  assert.match(authSource, /auth-register-form/);
});

test('Run79 browser theme metadata uses the unified graphite dark surface', () => {
  assert.match(read('src/app/theme.js'), /effective === 'dark' \? '#22292f'/);
  assert.match(read('public/landing-assets/public-controls.js'), /effective === 'dark' \? '#22292f'/);
});

test('About, Privacy and Terms load the shared Run79 public visual layer', () => {
  for (const page of ['public/about.html', 'public/privacy-policy.html', 'public/terms-of-service.html']) {
    assert.match(read(page), /\/landing-assets\/run79-public-visual-fix\.css/);
  }
});

test('About page keeps the accessible code-native interface previews', () => {
  const html = read('public/about.html');
  assert.match(html, /class="hero-gallery"/);
  assert.equal((html.match(/class="code-preview /g) || []).length, 2);
  assert.equal((html.match(/class="mini-preview /g) || []).length, 4);
  assert.equal((html.match(/class="showcase-code-preview /g) || []).length, 3);
  assert.match(html, /ইন্টারফেস প্রিভিউ/);
  assert.doesNotMatch(html, /কোডে তৈরি|code-built/i);
});

test('About English feature labels use natural wrapping instead of character splitting', () => {
  const css = read('public/landing-assets/run79-public-visual-fix.css');
  assert.match(css, /\.about-page \.hero-points span[\s\S]*?display:\s*flex/);
  assert.match(css, /overflow-wrap:\s*break-word/);
  assert.match(css, /word-break:\s*normal/);
  assert.doesNotMatch(css, /hero-points span[\s\S]*?overflow-wrap:\s*anywhere/);
});

test('Run75 retains the existing authentication form and submit flow', () => {
  const auth = read('src/features/auth/AuthPage.jsx');
  assert.match(auth, /auth-register-form/);
  assert.match(auth, /onSubmit=\{submit\}/);
  assert.match(auth, /submit\s*=\s*async/);
});
