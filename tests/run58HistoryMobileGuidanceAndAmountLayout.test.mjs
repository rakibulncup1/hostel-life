import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const jsx = readFileSync(new URL('../src/features/history/HistoryPage.jsx', import.meta.url), 'utf8');
const finishCss = readFileSync(new URL('../src/styles/history-finish-v13.css', import.meta.url), 'utf8');
const historyCss = readFileSync(new URL('../src/features/history/history-page-visual-refinement.css', import.meta.url), 'utf8');

test('History removes the redundant top permission card but preserves selected-archive access context', () => {
  assert.doesNotMatch(jsx, /history-intro-guidance-box|সম্পাদনা শুধু যে অ্যাকাউন্ট মাসটি বন্ধ করেছে/);
  assert.match(jsx, /archive-scope-note is-readonly/);
  assert.match(jsx, /সম্পাদনা শুধু যিনি মাসটি বন্ধ করেছেন তিনিই করতে পারবেন/);
  assert.doesNotMatch(jsx, /বাজার, জমা-খরচ ও আগের মাসের সংরক্ষিত হিসাব দেখুন|বিস্তারিত খুলতে যেকোনো রেকর্ডে চাপ দিন/);
  assert.match(finishCss, /history-archive-scope/);
});

test('market history cards place buyer, item count and serial on one line without a separate detail button', () => {
  assert.match(jsx, /history-market-title-row[\s\S]*?history-market-item-count[\s\S]*?history-market-serial/);
  assert.doesNotMatch(jsx, /history-market-bottom-row|history-row-open-hint/);
  assert.match(finishCss, /\.history-market-title-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto 29px/);
  assert.match(finishCss, /\.history-market-copy \.history-market-item-count/);
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
  const marketStart = finishCss.indexOf('/* Market cards:');
  const accountStart = finishCss.indexOf('/* Account history:', marketStart);
  const marketRules = finishCss.slice(marketStart, accountStart > marketStart ? accountStart : undefined);
  assert.ok(marketStart >= 0);
  assert.match(marketRules, /\.history-experience \.history-list \.history-market-entry-card/);
  assert.doesNotMatch(marketRules, /\.telegram-|\.archive-|\.dashboard-/);
});
