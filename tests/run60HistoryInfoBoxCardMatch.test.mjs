import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/features/history/history-page-visual-refinement.css', import.meta.url), 'utf8');
const run60 = css.slice(css.lastIndexOf('/* Run60:'));
const boxRule = run60.slice(run60.indexOf('.history-intro-guidance-box {'), run60.indexOf('\n}\n', run60.indexOf('.history-intro-guidance-box {')) + 2);
const mobileStart = run60.indexOf('@media (max-width: 640px)');
const mobile = run60.slice(mobileStart);

test('History info box uses the same standard surface tokens as white cards', () => {
  assert.match(boxRule, /background:\s*var\(--surface\)/);
  assert.match(boxRule, /border:\s*1px solid var\(--line\)/);
  assert.match(boxRule, /border-radius:\s*var\(--radius-lg\)/);
  assert.match(boxRule, /box-shadow:\s*var\(--shadow\)/);
  assert.doesNotMatch(boxRule, /linear-gradient|color-mix\(/);
});

test('Info box keeps a natural height and enough readable spacing on phones', () => {
  assert.ok(mobileStart >= 0, 'mobile media query is present');
  assert.match(mobile, /width:\s*100%/);
  assert.match(mobile, /height:\s*auto/);
  assert.match(mobile, /min-height:\s*0/);
  assert.match(mobile, /padding:\s*13px 14px/);
  assert.match(mobile, /line-height:\s*1\.65/);
});

test('Info box typography stays quiet and regular weight', () => {
  assert.match(boxRule, /color:\s*var\(--muted\)/);
  assert.match(boxRule, /font-size:\s*12px/);
  assert.match(boxRule, /font-weight:\s*400/);
  assert.match(run60, /\.history-intro-guidance-box\s*>\s*span\s*\{[\s\S]*?font-weight:\s*400/);
});

test('long Bangla guidance wraps without clipping or fixed-height truncation', () => {
  assert.match(run60, /overflow-wrap:\s*anywhere/);
  assert.match(run60, /white-space:\s*normal/);
  assert.match(boxRule, /overflow:\s*visible/);
  assert.doesNotMatch(boxRule, /height:\s*\d+px/);
});

test('Run60 changes only the History guidance box, not market cards or other features', () => {
  assert.doesNotMatch(run60, /history-market-entry-card|history-market-amount|\.dining-|\.telegram-|\.archive-|\.dashboard-|\.menu-page/);
});

