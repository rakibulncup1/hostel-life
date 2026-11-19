import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const html = fs.readFileSync(path.join(root, 'public/about.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/landing-assets/run85-about-preview-polish.css'), 'utf8');

test('Run85 About polish stylesheet is loaded exactly once after Run84', () => {
  const link = '<link rel="stylesheet" href="/landing-assets/run85-about-preview-polish.css">';
  assert.equal(html.split(link).length - 1, 1);
  assert.ok(html.indexOf('run85-about-preview-polish.css') > html.indexOf('run84-about-preview-containment.css'));
});

test('Run85 CSS selectors are isolated to the About page', () => {
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [...uncommented.matchAll(/(^|\})\s*([^@{}][^{}]*)\s*\{/g)].map((m) => m[2].trim());
  assert.ok(selectors.length >= 20, 'expected scoped component rules');
  for (const selector of selectors) {
    if (selector.startsWith('@media')) continue;
    assert.ok(selector.startsWith('.about-page'), `non-About selector found: ${selector}`);
  }
});

test('Preview text wraps at word boundaries instead of arbitrary character boundaries', () => {
  assert.match(css, /overflow-wrap:\s*break-word/);
  assert.match(css, /word-break:\s*normal/);
  assert.doesNotMatch(css, /overflow-wrap:\s*anywhere/);
});

test('Currency and numeric values remain intact within shrinkable cells', () => {
  for (const cls of ['.mini-market-row b', '.mini-preview-total strong', '.deposit-amount b', '.allowance-list b', '.report-metric-grid strong']) {
    assert.ok(css.includes(cls), `missing value selector ${cls}`);
  }
  assert.match(css, /white-space:\s*nowrap/);
  assert.match(css, /font-variant-numeric:\s*tabular-nums/);
});

test('Meal, market, deposit and allowance preview rows have shrinkable tracks', () => {
  assert.match(css, /\.mini-meal-list\s*>\s*div\s*\{[^}]*grid-template-columns:\s*22px\s+minmax\(0,\s*1fr\)\s+minmax\(0,\s*max-content\)/s);
  assert.match(css, /\.about-page :is\(\.mini-table-head, \.mini-market-row\)\s*\{[^}]*grid-template-columns:\s*minmax\(0,/s);
  assert.match(css, /\.deposit-fields\s*\{[^}]*display:\s*grid/s);
  assert.match(css, /\.allowance-list\s*>\s*div\s*\{[^}]*display:\s*grid/s);
});

test('Request status and report table can wrap without expanding preview width', () => {
  assert.match(css, /\.request-status\s*\{[^}]*white-space:\s*normal/s);
  assert.match(css, /\.request-table-row\s*\{[^}]*min-height:\s*0/s);
  assert.match(css, /\.report-table-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,/s);
});

test('Menu preview preserves its icon rail while allowing long labels to wrap', () => {
  assert.match(css, /\.menu-preview-item\s*\{[^}]*grid-template-columns:\s*20px\s+minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.menu-preview-item\s*>\s*span\s*\{[^}]*overflow-wrap:\s*break-word/s);
});

test('Feature captions, tags and card copy can wrap naturally', () => {
  assert.match(css, /\.feature-meta\s*\{[^}]*flex-wrap:\s*wrap/s);
  assert.match(css, /\.about-page \.feature-tag/);
  assert.match(css, /\.about-page \.showcase-media figcaption/);
  assert.match(css, /white-space:\s*normal/);
  assert.match(css, /\.feature-copy\s+p/);
  assert.match(css, /\.showcase-copy\s+p/);
});

test('The About page contains all nine code-native preview roots covered by the layout rules', () => {
  const count = (selector) => (html.match(new RegExp(selector, 'g')) || []).length;
  assert.equal(count('class="code-preview'), 2);
  assert.equal(count('class="mini-preview mini-preview--'), 4);
  assert.equal(count('class="showcase-code-preview'), 3);
});

test('Responsive refinement is limited to About at tablet and narrow-mobile breakpoints', () => {
  assert.match(css, /@media\s*\(max-width:\s*900px\)/);
  assert.match(css, /@media\s*\(max-width:\s*640px\)/);
  assert.match(css, /@media\s*\(max-width:\s*380px\)/);
});
