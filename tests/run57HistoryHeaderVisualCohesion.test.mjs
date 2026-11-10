import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/features/history/history-page-visual-refinement.css', import.meta.url), 'utf8');
const jsx = readFileSync(new URL('../src/features/history/HistoryPage.jsx', import.meta.url), 'utf8');

test('desktop History header unifies title, guidance and actions in one surface', () => {
  assert.match(css, /@media \(min-width:\s*641px\)[\s\S]*?\.page-stack \.page-title-row\.history-title-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*0\.88fr\) minmax\(0,\s*1\.12fr\)/);
  assert.match(css, /\.history-title-row \.history-title-footer\s*\{[\s\S]*?display:\s*grid/);
});

test('History guidance is a subtle nested note rather than a competing bold card', () => {
  const rules = [...css.matchAll(/\.history-title-row \.history-intro-guidance-box\s*\{([^}]+)\}/g)];
  const rule = rules.at(-1)?.[1] || '';
  assert.match(rule, /background:\s*color-mix\(in srgb, var\(--surface\) 82%, var\(--primary-soft\)\)/);
  assert.match(rule, /font-weight:\s*400/);
  assert.match(rule, /box-shadow:\s*none/);
  assert.match(rule, /border-left:\s*1px/);
});

test('History heading typography is softly harmonized with the guidance note', () => {
  assert.match(css, /history-page-intro-copy \.eyebrow[\s\S]*?font-weight:\s*700/);
  assert.match(css, /history-page-intro-copy p[\s\S]*?font-weight:\s*400/);
  assert.match(jsx, /history-page-intro-copy[\s\S]*?history-intro-guidance-box/);
});

test('tablet layout stacks content inside the same header surface', () => {
  assert.match(css, /@media \(min-width:\s*641px\) and \(max-width:\s*920px\)[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /history-title-footer[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\) auto/);
});

test('phone layout has no new Run57 override', () => {
  const run57 = css.slice(css.lastIndexOf('/* Run57:'));
  assert.doesNotMatch(run57, /max-width:\s*640px/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.history-title-row \.history-intro-guidance-box/);
});

test('Run57 selectors stay scoped to the History header only', () => {
  const run57 = css.slice(css.lastIndexOf('/* Run57:'));
  assert.doesNotMatch(run57, /\.archive-|\.dining-|\.market-entry|\.menu-page|\.telegram-/);
  assert.match(run57, /\.page-stack \.page-title-row\.history-title-row/);
  assert.match(run57, /\.history-title-row \.history-intro-guidance-box/);
});
