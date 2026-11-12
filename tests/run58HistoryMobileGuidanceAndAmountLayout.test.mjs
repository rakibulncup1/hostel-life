import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const jsx = readFileSync(new URL('../src/features/history/HistoryPage.jsx', import.meta.url), 'utf8');
const finishCss = readFileSync(new URL('../src/styles/app-finish-polish-v61.css', import.meta.url), 'utf8');
const historyCss = readFileSync(new URL('../src/features/history/history-page-visual-refinement.css', import.meta.url), 'utf8');

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

test('mobile market cards keep buyer details above a full-width total footer', () => {
  const mobile = historyCss.slice(historyCss.indexOf('@media (max-width: 640px)'));
  assert.match(mobile, /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(mobile, /grid-template-areas:[\s\S]*?\"copy\"[\s\S]*?\"amount\"/);
  assert.match(historyCss, /\.history-market-amount\s*\{[\s\S]*?grid-area:\s*amount[\s\S]*?width:\s*100%/);
  assert.match(jsx, /history-market-amount-label[\s\S]*?মোট বাজার/);
  assert.match(jsx, /history-market-amount-value[\s\S]*?formatCurrency\(row\.total_amount\)/);
});

test('mobile market card retains the click indicator and compact title serial', () => {
  const mobile = historyCss.slice(historyCss.indexOf('@media (max-width: 640px)'));
  assert.match(mobile, /history-market-chevron/);
  assert.match(historyCss, /\.history-market-title-row > strong/);
  assert.match(historyCss, /\.history-market-serial\s*\{[\s\S]*?flex-basis:\s*27px/);
});


test('market history finishing styles stay scoped to market history cards', () => {
  const historyStart = finishCss.indexOf('/* Market history:');
  const historyEnd = finishCss.indexOf('/* App installation', historyStart);
  const historyRules = finishCss.slice(historyStart, historyEnd > historyStart ? historyEnd : undefined);
  assert.match(historyRules, /\.history-list \.history-market-entry-card/);
  assert.doesNotMatch(historyRules, /\.telegram-|\.archive-|\.dashboard-/);
});
