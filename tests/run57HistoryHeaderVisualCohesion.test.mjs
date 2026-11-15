import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/features/history/history-page-visual-refinement.css', import.meta.url), 'utf8');
const jsx = readFileSync(new URL('../src/features/history/HistoryPage.jsx', import.meta.url), 'utf8');
const finishCss = readFileSync(new URL('../src/styles/history-finish-v13.css', import.meta.url), 'utf8');

test('desktop History header keeps a clear title and aligned actions', () => {
  assert.match(css, /@media \(min-width:\s*641px\)[\s\S]*?\.page-stack \.page-title-row\.history-title-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*0\.88fr\) minmax\(0,\s*1\.12fr\)/);
  assert.match(finishCss, /\.history-experience \.history-title-footer\s*\{[\s\S]*?display:\s*flex/);
  assert.match(finishCss, /\.history-title-actions\s*\{[\s\S]*?justify-content:\s*flex-end/);
});

test('History removes the redundant top permission card but retains contextual archive permission', () => {
  assert.doesNotMatch(jsx, /history-intro-guidance-box|সম্পাদনা শুধু যে অ্যাকাউন্ট মাসটি বন্ধ করেছে, সেই অ্যাকাউন্টের জন্য।/);
  assert.match(jsx, /archive-scope-note is-readonly/);
  assert.match(jsx, /সম্পাদনা শুধু যিনি মাসটি বন্ধ করেছেন তিনিই করতে পারবেন/);
  assert.doesNotMatch(jsx, /বিস্তারিত খুলতে যেকোনো রেকর্ডে চাপ দিন|বাজার, জমা-খরচ ও আগের মাসের সংরক্ষিত হিসাব দেখুন/);
  assert.match(finishCss, /history-experience \.history-archive-scope/);
});

test('History heading keeps a concise title and supporting description', () => {
  assert.match(jsx, /history-page-intro-copy[\s\S]*?<h1>হিস্টরি<\/h1>[\s\S]*?<p>বাজার, হিসাব/);
  assert.match(css, /history-page-intro-copy \.eyebrow[\s\S]*?font-weight:\s*700/);
  assert.match(css, /history-page-intro-copy p[\s\S]*?font-weight:\s*400/);
});

test('tablet layout stacks the History title and actions cleanly', () => {
  assert.match(css, /@media \(min-width:\s*641px\) and \(max-width:\s*920px\)[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(finishCss, /\.history-title-footer\s*\{[\s\S]*?justify-content:\s*flex-end/);
});

test('phone layout keeps the History header clean and market cards responsive', () => {
  assert.doesNotMatch(jsx, /history-intro-guidance-box/);
  assert.match(finishCss, /@media \(max-width:\s*640px\)[\s\S]*?\.history-market-title-row/);
  assert.match(finishCss, /@media \(max-width:\s*360px\)[\s\S]*?\.history-market-title-row/);
});

test('market finishing styles stay scoped to market history cards', () => {
  const marketStart = finishCss.indexOf('/* Market cards:');
  const accountStart = finishCss.indexOf('/* Account history:', marketStart);
  const marketRules = finishCss.slice(marketStart, accountStart > marketStart ? accountStart : undefined);
  assert.ok(marketStart >= 0);
  assert.doesNotMatch(marketRules, /\.archive-|\.dining-|\.menu-page|\.telegram-/);
  assert.match(marketRules, /\.history-market-title-row/);
  assert.doesNotMatch(marketRules, /\.history-market-bottom-row/);
});
