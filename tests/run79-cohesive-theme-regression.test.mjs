import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('Run79 is loaded after Run78 without changing application feature modules', () => {
  const entry = read('src/main.jsx');
  assert.ok(entry.indexOf('run79-cohesive-theme-and-layout.css') > entry.indexOf('run78-visual-correction.css'));
  assert.match(entry, /run79-cohesive-theme-and-layout\.css/);
});

test('Run79 dark surfaces use layered graphite rather than near-black fills', () => {
  const css = read('src/styles/run79-cohesive-theme-and-layout.css');
  assert.match(css, /--bg:\s*#22292f/i);
  assert.match(css, /--surface:\s*#2d353d/i);
  assert.match(css, /--surface-2:\s*#354049/i);
  assert.doesNotMatch(css, /--bg:\s*#000(?:000)?\b/i);
  assert.match(css, /dashboard-reimagined[\s\S]*?--dash-green-bg:\s*#2f3d36/i);
  assert.match(css, /default-meal-box[\s\S]*?background:\s*#303a35/i);
});

test('Run79 preserves English type scale and prevents forced character-by-character wrapping', () => {
  const css = read('src/styles/run79-cohesive-theme-and-layout.css');
  assert.doesNotMatch(css, /font-size\s*:/i);
  assert.match(css, /overflow-wrap:\s*break-word/i);
  assert.match(css, /word-break:\s*normal/i);
  assert.doesNotMatch(css, /overflow-wrap:\s*anywhere/i);
});

test('Run79 public pages share one stylesheet and legal headings retain readable light contrast', () => {
  for (const page of ['public/about.html', 'public/privacy-policy.html', 'public/terms-of-service.html']) {
    assert.match(read(page), /run79-public-visual-fix\.css/);
  }
  const css = read('public/landing-assets/run79-public-visual-fix.css');
  assert.match(css, /:root:not\(\[data-theme="dark"\]\)[\s\S]*?\.legal-hero h1[\s\S]*?color:\s*#20352a/i);
  assert.match(css, /:root\[data-theme="dark"\][\s\S]*?\.legal-hero h1[\s\S]*?color:\s*#edf1f3/i);
});

test('Run79 About feature labels use a fixed icon column and natural text wrapping', () => {
  const css = read('public/landing-assets/run79-public-visual-fix.css');
  assert.match(css, /\.about-page \.hero-points span[\s\S]*?display:\s*flex/);
  assert.match(css, /\.about-page \.hero-points \.tick[\s\S]*?flex:\s*0 0 20px/);
  assert.match(css, /overflow-wrap:\s*break-word/);
  assert.match(css, /word-break:\s*normal/);
  assert.doesNotMatch(css, /overflow-wrap:\s*anywhere/);
});

test('Run79 keeps About previews compact and dark preview copy readable', () => {
  const css = read('public/landing-assets/run79-public-visual-fix.css');
  assert.match(css, /\.screen-card \.code-preview--dashboard[\s\S]*?min-height:\s*225px/);
  assert.match(css, /\.showcase-code-preview[\s\S]*?min-height:\s*185px/);
  assert.match(css, /:root\[data-theme="dark"\] \.about-page[\s\S]*?\.showcase-copy h3[\s\S]*?color:\s*#e8eef0/i);
});
