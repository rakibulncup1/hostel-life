import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const jsx = readFileSync(new URL('../src/features/history/HistoryPage.jsx', import.meta.url), 'utf8');
const finishCss = readFileSync(new URL('../src/styles/app-finish-polish-v61.css', import.meta.url), 'utf8');

test('History keeps a compact closer-permission note without the old instruction paragraph', () => {
  assert.match(jsx, /সম্পাদনা শুধু যে অ্যাকাউন্ট মাসটি বন্ধ করেছে/);
  assert.doesNotMatch(jsx, /বাজার, জমা-খরচ ও আগের মাসের সংরক্ষিত হিসাব দেখুন|বিস্তারিত খুলতে যেকোনো রেকর্ডে চাপ দিন/);
  assert.match(finishCss, /history-intro-guidance-box[\s\S]*?padding:\s*0/);
});

test('market history cards place the serial on the buyer title line and pair item count with details', () => {
  assert.match(jsx, /history-market-title-row[\s\S]*?history-market-serial/);
  assert.match(jsx, /history-market-bottom-row[\s\S]*?history-market-item-count[\s\S]*?history-row-open-hint/);
  assert.match(finishCss, /\.history-market-title-row\s*\{[\s\S]*?justify-content:\s*space-between/);
  assert.match(finishCss, /\.history-market-bottom-row\s*\{[\s\S]*?justify-content:\s*space-between/);
});

test('mobile market cards use a compact two-column layout without the old detached amount row', () => {
  const mobile = finishCss.slice(finishCss.indexOf('@media (max-width: 640px)'));
  assert.match(mobile, /\.history-list \.history-market-entry-card\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\) auto/);
  assert.match(mobile, /grid-template-areas:\s*none !important/);
  assert.match(mobile, /\.history-market-copy\s*\{[\s\S]*?grid-column:\s*1/);
  assert.match(mobile, /\.history-market-amount\s*\{[\s\S]*?grid-column:\s*2/);
});

test('narrow phones keep the market serial inside the title row and hide the redundant chevron', () => {
  const mobile = finishCss.slice(finishCss.indexOf('@media (max-width: 640px)'));
  assert.match(mobile, /\.history-market-chevron\s*\{\s*display:\s*none/);
  assert.match(finishCss, /\.history-market-title-row > strong/);
  assert.match(finishCss, /\.history-market-serial\s*\{[\s\S]*?flex-basis:\s*28px/);
});

test('market card preserves its existing detail action and financial summary', () => {
  assert.match(jsx, /onClick=\{\(\) => onOpen\(row\.market_entry_id\)\}/);
  assert.match(jsx, /formatCurrency\(row\.total_amount\)/);
  assert.match(jsx, /row\.credit_to_buyer \? 'জমায় যুক্ত' : 'জমায় নয়'/);
  assert.match(jsx, /history-market-chevron/);
});

test('market history finishing styles stay scoped to market history cards', () => {
  const historyStart = finishCss.indexOf('/* Market history:');
  const historyEnd = finishCss.indexOf('/* App installation', historyStart);
  const historyRules = finishCss.slice(historyStart, historyEnd > historyStart ? historyEnd : undefined);
  assert.match(historyRules, /\.history-list \.history-market-entry-card/);
  assert.doesNotMatch(historyRules, /\.telegram-|\.archive-|\.dashboard-/);
});
