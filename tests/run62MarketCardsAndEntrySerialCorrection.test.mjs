import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const history = read('src/features/history/HistoryPage.jsx');
const historyCss = read('src/features/history/history-page-visual-refinement.css');
const entryCss = read('src/styles/app-finish-polish-v61.css');
const sharedFinishCss = entryCss;

test('History market card amount is a labelled full-width footer beneath the buyer details', () => {
  assert.match(history, /history-market-title-row[\s\S]*?history-market-bottom-row/);
  assert.match(history, /history-market-amount-label[^>]*>মোট বাজার/);
  assert.match(history, /history-market-amount-value[\s\S]*?formatCurrency\(row\.total_amount\)[\s\S]*?row\.credit_to_buyer \? 'জমায় যুক্ত' : 'জমায় নয়'/);
  assert.match(historyCss, /grid-template-areas:[\s\S]*?\"copy chevron\"[\s\S]*?\"amount amount\"/);
  assert.match(sharedFinishCss, /Run63: History market card full-width amount footer/);
  assert.match(sharedFinishCss, /grid-template-areas:\s*\"copy chevron\" \"amount amount\" !important/);
  assert.match(historyCss, /\.history-market-amount\s*\{[\s\S]*?grid-area:\s*amount[\s\S]*?justify-content:\s*space-between[\s\S]*?width:\s*100%/);
  assert.match(historyCss, /\.history-market-amount-label/);
  assert.match(historyCss, /\.history-market-amount-value > strong/);
});

test('desktop and mobile History cards preserve the same full-width amount footer', () => {
  const mobile = historyCss.slice(historyCss.indexOf('@media (max-width: 640px)'));
  assert.match(historyCss, /grid-template-columns:\s*minmax\(0, 1fr\) 18px/);
  assert.match(mobile, /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(mobile, /grid-template-areas:[\s\S]*?\"copy\"[\s\S]*?\"amount\"/);
  assert.match(mobile, /\.history-market-chevron\s*\{\s*display:\s*none/);
  assert.doesNotMatch(mobile, /grid-template-columns:\s*minmax\(0, 1fr\) 104px/);
  assert.match(historyCss, /@media \(max-width: 380px\)[\s\S]*?history-market-amount-value > strong[\s\S]*?font-size:\s*12\.5px/);
});

test('mobile market-entry serial resets the old absolute positioning and sits above the first input line', () => {
  const mobile = entryCss.slice(entryCss.indexOf('@media (max-width: 560px)'));
  assert.match(mobile, /market-item-row > \.market-serial[\s\S]*?position:\s*relative !important[\s\S]*?inset:\s*auto !important/);
  assert.match(mobile, /market-item-row > \.market-serial[\s\S]*?grid-column:\s*1 !important[\s\S]*?grid-row:\s*1 !important/);
  assert.match(mobile, /market-item-row > \.market-serial[\s\S]*?transform:\s*translateY\(-4px\)/);
  assert.match(mobile, /market-item-row > \.market-input-item[\s\S]*?grid-column:\s*2 \/ 5 !important/);
  assert.doesNotMatch(mobile, /market-item-row \.market-serial[\s\S]*?position:\s*absolute/);
});

test('narrow phones keep the serial in the dedicated grid gutter without overlaying the item field', () => {
  const narrow = entryCss.slice(entryCss.indexOf('@media (max-width: 380px)'));
  assert.match(narrow, /grid-template-columns:\s*26px minmax\(0, 1fr\) minmax\(0, 1fr\) 30px/);
  assert.match(narrow, /transform:\s*translateY\(-3px\)/);
});
