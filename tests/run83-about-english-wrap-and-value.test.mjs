import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const about = readFileSync(new URL('../public/about.html', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/language-runtime.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/landing-assets/run83-about-english-feature-wrap.css', import.meta.url), 'utf8');

const pointKeys = ['meals', 'market', 'reports'];

test('Run83 About stylesheet is loaded after the existing Run82 About layer', () => {
  const run82 = about.indexOf('/landing-assets/run82-about-dark-surface-audit.css');
  const run83 = about.indexOf('/landing-assets/run83-about-english-feature-wrap.css');
  assert.ok(run82 >= 0, 'Run82 stylesheet link must remain present');
  assert.ok(run83 > run82, 'Run83 layer must load after Run82');
});

test('English hero-point icons are protected from duplicate text translation', () => {
  for (const key of pointKeys) {
    const re = new RegExp(`<span data-i18n-key="about\\.hero\\.point\\.${key}"><i class="tick" aria-hidden="true" data-no-translate>✓<\\/i><span class="hero-point-label">[^<]+<\\/span><\\/span>`);
    assert.match(about, re, `${key} point should keep the icon outside translated text`);
  }
});

test('English hero labels have their own shrinkable grid cell', () => {
  assert.match(css, /:root\[data-language="en"\] \.about-page \.hero-points > span\s*\{[\s\S]*?grid-template-columns:\s*20px minmax\(0, 1fr\)/);
  assert.match(css, /\.hero-points \.hero-point-label\s*\{[\s\S]*?min-width:\s*0/);
  assert.match(css, /height:\s*auto/);
  assert.doesNotMatch(css, /(?<!min-)height:\s*\d+px/);
  assert.doesNotMatch(css, /font-size\s*:/, 'Run83 must not change the English font size');
});

test('English hero chips switch to full-width rows on small screens', () => {
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.hero-points\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test('About monthly meal-rate amount has a dedicated English translation', () => {
  assert.match(about, /<strong data-i18n-key="about\.report\.mealRate\.value">৳ ৪২\.৫০<\/strong>/);
  assert.match(runtime, /'about\.report\.mealRate\.value':\s*'৳ 42\.50'/);
});

test('Run83 CSS rules are scoped to the About page and English locale', () => {
  const selectors = css.split('{').slice(0, -1).join('{');
  assert.match(selectors, /\.about-page/);
  assert.doesNotMatch(css, /:root\[data-theme=/, 'Run83 must not change any theme palette');
  assert.doesNotMatch(css, /body\s*\{|\.site-header\s*\{|\.feature-card\s*\{/, 'Run83 must not target shared page surfaces');
});
