import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/features/history/history-page-visual-refinement.css', import.meta.url), 'utf8');
const jsx = readFileSync(new URL('../src/features/history/HistoryPage.jsx', import.meta.url), 'utf8');
const run58 = css.slice(css.lastIndexOf('/* Run58:'));

test('mobile History guidance is quiet, theme-aware and no longer a highlighted nested box', () => {
  assert.match(run58, /@media \(max-width: 640px\)/);
  assert.match(run58, /\.history-intro-guidance-box\s*\{[\s\S]*?background:\s*transparent/);
  assert.match(run58, /\.history-intro-guidance-box\s*\{[\s\S]*?border:\s*0/);
  assert.match(run58, /\.history-intro-guidance-box\s*\{[\s\S]*?box-shadow:\s*none/);
  assert.match(run58, /\.history-intro-guidance-box\s*\{[\s\S]*?font-weight:\s*400/);
});

test('mobile History guidance fills the available width and wraps long copy without clipping', () => {
  assert.match(run58, /\.history-intro-guidance-box\s*\{[\s\S]*?width:\s*100%/);
  assert.match(run58, /\.history-intro-guidance-box\s*\{[\s\S]*?height:\s*auto/);
  assert.match(run58, /\.history-intro-guidance-box\s*>\s*span\s*\{[\s\S]*?overflow-wrap:\s*break-word/);
  assert.match(run58, /line-height:\s*1\.7/);
});

test('mobile market amount gets its own full-width horizontal row', () => {
  assert.match(run58, /grid-template-areas:[\s\S]*?"serial copy chevron"\s*"amount amount amount"/);
  assert.match(run58, /\.history-market-entry-card\s*>\s*\.history-market-amount\s*\{[\s\S]*?grid-area:\s*amount/);
  assert.match(run58, /\.history-market-entry-card\s*>\s*\.history-market-amount\s*\{[\s\S]*?justify-content:\s*flex-end/);
  assert.match(run58, /content:\s*"মোট বাজার"/);
});

test('narrow phones keep amount full width and do not push it into the lower-right corner', () => {
  const narrow = run58.slice(run58.indexOf('@media (max-width: 560px)'));
  assert.match(narrow, /grid-template-areas:[\s\S]*?"serial copy"\s*"amount amount"/);
  assert.match(narrow, /history-market-chevron\s*\{\s*display:\s*none/);
  assert.doesNotMatch(narrow, /justify-self:\s*end/);
});

test('market card still opens the same detail and displays the original total/status values', () => {
  assert.match(jsx, /onClick=\{\(\) => onOpen\(row\.market_entry_id\)\}/);
  assert.match(jsx, /formatCurrency\(row\.total_amount\)/);
  assert.match(jsx, /row\.credit_to_buyer \? 'জমায় যুক্ত' : 'জমায় নয়'/);
  assert.match(jsx, /history-market-chevron/);
});

test('Run58 styles and markup remain scoped to History and market history only', () => {
  assert.doesNotMatch(run58, /\.dining-|\.telegram-|\.archive-|\.menu-page|\.dashboard-/);
  assert.match(jsx, /import '\.\/history-page-visual-refinement\.css';/);
});
