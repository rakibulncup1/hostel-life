import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('Run76 stylesheet is loaded after existing presentation styles', () => {
  const main = read('src/main.jsx');
  assert.match(main, /run74-professional-polish\.css/);
  assert.match(main, /run76-readability-graphite\.css/);
  assert.match(main, /run77-balanced-dark-and-wrap\.css/);
  assert.ok(main.indexOf('run76-readability-graphite.css') > main.indexOf('run74-professional-polish.css'));
});

test('Run76 dark palette is scoped to dark theme and does not redefine light tokens', () => {
  const css = read('src/styles/run76-readability-graphite.css');
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /:root\[data-theme=\"dark\"\]/);
  assert.doesNotMatch(css, /:root:not\(\[data-theme="dark"\]\)/);
});

test('Run76 no longer overrides the established English font scale', () => {
  const css = read('src/styles/run76-readability-graphite.css');
  assert.doesNotMatch(css, /:root\[data-language=\"en\"\]/);
  assert.doesNotMatch(css, /font-size\s*:/);
  const polish = read('src/styles/run77-balanced-dark-and-wrap.css');
  assert.match(polish, /overflow-wrap:\s*break-word/);
  assert.doesNotMatch(polish, /font-size\s*:/);
});

test('About preview copy does not disclose implementation details', () => {
  const html = read('public/about.html');
  assert.doesNotMatch(html, /কোডে তৈরি|code-built|code generated/i);
  assert.match(html, /ইন্টারফেস প্রিভিউ/);
  const runtime = read('public/language-runtime.js');
  assert.match(runtime, /Hostel Life app interface previews/);
  assert.doesNotMatch(runtime, /Code-built sample UI|Code-built preview/);
});

test('About-only preview finishing remains scoped to the public About page', () => {
  const css = read('public/landing-assets/public-experience.css');
  assert.match(css, /\.about-page \.code-preview/);
  assert.match(css, /\.about-page \.showcase-code-preview/);
  assert.match(css, /:root\[data-language="en"\] \.about-page/);
});
