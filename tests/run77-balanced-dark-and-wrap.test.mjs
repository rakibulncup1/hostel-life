import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('Run77 styles load after all previous app presentation styles', () => {
  const main = read('src/main.jsx');
  assert.ok(main.indexOf('run77-balanced-dark-and-wrap.css') > main.indexOf('run76-readability-graphite.css'));
});

test('English font scale is not globally enlarged by Run76 or Run77', () => {
  const previous = read('src/styles/run76-readability-graphite.css');
  const current = read('src/styles/run77-balanced-dark-and-wrap.css');
  assert.doesNotMatch(previous, /font-size\s*:/);
  assert.doesNotMatch(current, /font-size\s*:/);
  assert.match(current, /overflow-wrap:\s*break-word/);
  assert.doesNotMatch(current, /overflow-wrap:\s*anywhere/);
});

test('Dark theme is a layered neutral graphite palette, not near-black or saturated green', () => {
  const css = read('src/styles/run77-balanced-dark-and-wrap.css');
  assert.match(css, /--bg:\s*#20262c/);
  assert.match(css, /--surface:\s*#293139/);
  assert.match(css, /--surface-2:\s*#323b44/);
  assert.match(css, /--primary:\s*#aebdb3/);
  assert.doesNotMatch(css, /--bg:\s*#0[0-9a-f]{5}/i);
});

test('English card content wraps without clipping or forced word breaking', () => {
  const css = read('src/styles/run77-balanced-dark-and-wrap.css');
  assert.match(css, /height:\s*auto/);
  assert.match(css, /min-width:\s*0/);
  assert.match(css, /word-break:\s*normal/);
  assert.match(css, /overflow-wrap:\s*break-word/);
});

test('About preview dimensions are compact at desktop and mobile breakpoints', () => {
  const css = read('public/landing-assets/public-experience.css');
  assert.match(css, /\.about-page \.screen-card \.code-preview--dashboard,[\s\S]*?min-height:\s*265px/);
  assert.match(css, /\.about-page \.mini-preview\s*\{\s*min-height:\s*175px/);
  assert.match(css, /\.about-page \.showcase-code-preview\s*\{\s*min-height:\s*205px/);
  assert.match(css, /@media \(max-width:\s*640px\)[\s\S]*?min-height:\s*225px/);
  assert.doesNotMatch(css, /font-size:\s*max\(10px,\s*\.88em\)/);
});
