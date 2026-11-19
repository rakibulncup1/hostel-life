import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('Run82 loads after the Run81 About-only dark system', () => {
  const html = read('public/about.html');
  const run81 = html.indexOf('/landing-assets/run81-about-dark-surface-system.css');
  const run82 = html.indexOf('/landing-assets/run82-about-dark-surface-audit.css');
  assert.ok(run81 >= 0, 'Run81 baseline link must remain present');
  assert.ok(run82 > run81, 'Run82 must be the final About stylesheet');
});

test('Screenshot-identified pale About panels receive dark surfaces and readable text', () => {
  const css = read('public/landing-assets/run82-about-dark-surface-audit.css');
  assert.match(css, /:root\[data-theme="dark"\] body\.about-page :is\(\.proof-item, \.section-head p, \.hero-copy\)/);
  assert.match(css, /\.proof-item strong[\s\S]*?color:\s*var\(--run82-about-heading\)/);
  assert.match(css, /\.proof-item small[\s\S]*?color:\s*var\(--run82-about-muted\)/);
  assert.match(css, /\.section-head p[\s\S]*?background:\s*var\(--run82-about-surface\)/);
});

test('Nested mockup surfaces with pale defaults are included in About dark styling', () => {
  const css = read('public/landing-assets/run82-about-dark-surface-audit.css');
  for (const selector of [
    '.feature-image-frame', '.screen-card', '.screen-toolbar', '.preview-date',
    '.preview-stat', '.preview-meal-panel', '.preview-action-tile',
    '.mini-date-strip span', '.mini-meal-list > div', '.mini-market-row',
    '.mini-preview-total', '.deposit-summary', '.deposit-fields',
    '.allowance-summary > div', '.allowance-list > div',
    '.request-summary-grid > div', '.request-table-row',
    '.report-metric-grid > div', '.report-table-row', '.menu-preview-item'
  ]) assert.ok(css.includes(selector), `Missing dark About surface: ${selector}`);
});

test('Run82 is strictly dark-theme and About-page scoped', () => {
  const css = read('public/landing-assets/run82-about-dark-surface-audit.css');
  assert.doesNotMatch(css, /:root\[data-theme="light"\]|:root\[data-theme="blue"\]/);
  assert.doesNotMatch(css, /:root\[data-theme="dark"\]\s+(?:body\s*\{|\.site-header|\.feature-card)/);
  assert.doesNotMatch(css, /\.auth-page|\.dashboard-page|\.profile-page|\.privacy-page/);
});

test('Run82 leaves real screenshot assets unfiltered and does not alter image opacity', () => {
  const css = read('public/landing-assets/run82-about-dark-surface-audit.css');
  assert.doesNotMatch(css, /\.screen-card img|\.showcase-media img|filter:\s*(?:brightness|grayscale|invert|none)/);
  assert.doesNotMatch(css, /opacity:\s*0(?:\D|$)/);
});

test('Patch has no application logic, shared theme logic, or other public page stylesheet edits', () => {
  const html = read('public/about.html');
  const css = read('public/landing-assets/run82-about-dark-surface-audit.css');
  assert.equal((html.match(/run82-about-dark-surface-audit\.css/g) || []).length, 1);
  assert.doesNotMatch(css, /@import|url\(/);
  assert.doesNotMatch(html, /run82.*(?:privacy|terms|main\.jsx)/i);
});
