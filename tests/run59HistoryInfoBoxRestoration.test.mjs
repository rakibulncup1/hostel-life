import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/features/history/history-page-visual-refinement.css', import.meta.url), 'utf8');
const run59 = css.slice(css.lastIndexOf('/* Run59:'));
const infoBlock = run59.slice(run59.indexOf('.history-intro-guidance-box {'), run59.indexOf('.history-intro-guidance-box > span'));

test('History intro guidance is restored as a quiet mobile info box', () => {
  assert.match(run59, /@media \(max-width: 640px\)/);
  assert.match(infoBlock, /width:\s*100%/);
  assert.match(infoBlock, /height:\s*auto/);
  assert.match(infoBlock, /padding:\s*10px 12px/);
  assert.match(infoBlock, /border:\s*1px solid/);
  assert.match(infoBlock, /background:\s*color-mix/);
  assert.match(infoBlock, /border-radius:\s*11px/);
  assert.match(infoBlock, /box-shadow:\s*none/);
});

test('Info box copy remains regular-weight, readable and theme-muted', () => {
  assert.match(infoBlock, /color:\s*var\(--muted\)/);
  assert.match(infoBlock, /font-size:\s*12px/);
  assert.match(infoBlock, /font-weight:\s*400/);
  assert.match(infoBlock, /line-height:\s*1\.65/);
  assert.doesNotMatch(infoBlock, /background:\s*transparent/);
  assert.doesNotMatch(infoBlock, /border:\s*0/);
});

test('the same mobile stylesheet still keeps the market amount on its established full-width row', () => {
  assert.match(run59, /grid-template-areas:[\s\S]*?"serial copy chevron"\s*"amount amount amount"/);
  assert.match(run59, /\.history-market-entry-card\s*>\s*\.history-market-amount\s*\{[\s\S]*?grid-area:\s*amount/);
  assert.match(run59, /content:\s*"মোট বাজার"/);
});

test('Run59 override is scoped only to the History info box', () => {
  assert.doesNotMatch(run59, /\.dining-|\.telegram-|\.archive-|\.dashboard-|\.menu-page/);
});
