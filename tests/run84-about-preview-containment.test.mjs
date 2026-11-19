import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync(resolve('public/about.html'), 'utf8');
const css = readFileSync(resolve('public/landing-assets/run84-about-preview-containment.css'), 'utf8');
const baseCss = readFileSync(resolve('public/landing-assets/public-experience.css'), 'utf8');

function hasRule(selector, declarations) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's'))?.[1] || '';
  return declarations.every((declaration) => block.includes(declaration));
}

test('Run84 About-only stylesheet is loaded after the Run83 preview translation/layout fix', () => {
  const run83 = html.indexOf('/landing-assets/run83-about-english-feature-wrap.css');
  const run84 = html.indexOf('/landing-assets/run84-about-preview-containment.css');
  assert.ok(run83 >= 0 && run84 > run83);
});

test('all code-native preview roots and descendants use shrinkable border-box sizing', () => {
  assert.match(css, /\.about-page\s+:is\(\.code-preview,\s*\.mini-preview,\s*\.showcase-code-preview\)[\s\S]*?box-sizing:\s*border-box;[\s\S]*?min-width:\s*0;/);
});

test('report metrics and request status badges may wrap instead of forcing overflow', () => {
  assert.match(css, /\.about-page \.report-metric-grid strong,\s*\.about-page \.request-status\s*\{[\s\S]*?white-space:\s*normal;[\s\S]*?overflow-wrap:\s*anywhere;/);
  assert.match(baseCss, /\.report-metric-grid strong[^}]*white-space:\s*nowrap/);
});

test('table rows and preview values receive shrinkable grid/flex cells', () => {
  assert.match(css, /\.about-page \.report-table-head,\s*\.about-page \.report-table-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*auto\)/);
  assert.match(css, /\.about-page \.menu-preview-item\s*\{[\s\S]*?grid-template-columns:\s*22px\s+minmax\(0,\s*1fr\)/);
  assert.match(css, /\.about-page \.request-table-head,\s*\.about-page \.request-table-row\s*\{[\s\S]*?minmax\(0,\s*1\.1fr\)/);
});

test('feature mockup frames and mini previews grow with their text instead of clipping it', () => {
  assert.match(css, /\.about-page \.feature-image-frame\s*\{[\s\S]*?height:\s*auto;[\s\S]*?overflow:\s*visible;/);
  assert.match(css, /\.about-page \.feature-image-frame\s*>\s*\.mini-preview\s*\{[\s\S]*?height:\s*auto;[\s\S]*?overflow:\s*visible;/);
  assert.match(css, /\.about-page \.showcase-code-preview\s*\{[\s\S]*?height:\s*auto;[\s\S]*?overflow:\s*visible;/);
});

test('menu and report showcase previews receive more desktop width', () => {
  assert.match(css, /@media\s*\(min-width:\s*761px\)[\s\S]*?\.about-page \.showcase-card--menu,[\s\S]*?\.about-page \.showcase-card--report\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*\.92fr\)\s+minmax\(0,\s*1\.08fr\)/);
  assert.equal((html.match(/showcase-media--code/g) || []).length, 3);
});

test('mobile header displays Hostel Life beside the logo', () => {
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.about-page \.brand\s*\{[\s\S]*?font-size:\s*14px;[\s\S]*?white-space:\s*nowrap;/);
  assert.doesNotMatch(css, /\.about-page \.brand\s*\{[^}]*font-size:\s*0/);
});

test('mobile download action remains available in the existing menu when compact top row hides it', () => {
  assert.match(css, /@media\s*\(max-width:\s*390px\)[\s\S]*?\.about-page \.nav-actions\s*>\s*\.nav-download\s*\{\s*display:\s*none;/);
  assert.match(html, /<nav class="mobile-menu-panel"[\s\S]*?data-pwa-install-link/);
});

test('Run84 stylesheet is About-scoped and does not introduce shared theme or app selectors', () => {
  assert.doesNotMatch(css, /(^|\n)\s*(?:html|body|:root)(?:\s|\{|\[)/m);
  assert.doesNotMatch(css, /--(?:paper|surface|ink|muted|line|green|about-bg)\s*:/);
  assert.match(css, /\.about-page/);
});
