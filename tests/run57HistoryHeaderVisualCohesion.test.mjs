import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/features/history/history-page-visual-refinement.css', import.meta.url), 'utf8');
const jsx = readFileSync(new URL('../src/features/history/HistoryPage.jsx', import.meta.url), 'utf8');
const finishCss = readFileSync(new URL('../src/styles/app-finish-polish-v61.css', import.meta.url), 'utf8');

test('desktop History header keeps a clear title and aligned actions', () => {
  assert.match(css, /@media \(min-width:\s*641px\)[\s\S]*?\.page-stack \.page-title-row\.history-title-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*0\.88fr\) minmax\(0,\s*1\.12fr\)/);
  assert.match(finishCss, /\.history-title-footer\s*\{[\s\S]*?display:\s*flex !important/);
  assert.match(finishCss, /\.history-title-actions\s*\{[\s\S]*?justify-content:\s*flex-end/);
});

test('History keeps only the concise month-closer permission note, not a large instruction card', () => {
  assert.match(jsx, /history-intro-guidance-box[\"'][^>]*><span>সম্পাদনা শুধু যে অ্যাকাউন্ট মাসটি বন্ধ করেছে, সেই অ্যাকাউন্টের জন্য।/);
  assert.doesNotMatch(jsx, /বিস্তারিত খুলতে যেকোনো রেকর্ডে চাপ দিন|বাজার, জমা-খরচ ও আগের মাসের সংরক্ষিত হিসাব দেখুন/);
  assert.match(finishCss, /history-intro-guidance-box[\s\S]*?padding:\s*0/);
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

test('phone layout keeps the permission note compact and does not restore a large guidance card', () => {
  assert.match(jsx, /সম্পাদনা শুধু যে অ্যাকাউন্ট মাসটি বন্ধ করেছে/);
  assert.match(finishCss, /@media \(max-width:\s*640px\)[\s\S]*?\.history-title-row \.history-intro-guidance-box/);
  assert.match(finishCss, /@media \(max-width:\s*640px\)[\s\S]*?\.history-list \.history-market-entry-card/);
});

test('finishing styles stay scoped to History-specific selectors', () => {
  const historyStart = finishCss.indexOf('/* Market history:');
  const historyEnd = finishCss.indexOf('/* App installation', historyStart);
  const historyRules = finishCss.slice(historyStart, historyEnd > historyStart ? historyEnd : undefined);
  assert.doesNotMatch(historyRules, /\.archive-|\.dining-|\.menu-page|\.telegram-/);
  assert.match(historyRules, /\.history-market-title-row/);
  assert.match(historyRules, /\.history-market-bottom-row/);
});
