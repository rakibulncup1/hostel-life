import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('closed-month PDF follow-up guidance is presented as a compact theme-aware note', () => {
  const css = read('src/features/archive/archive-correction.css');
  assert.match(css, /\.archive-correction-page \.archive-detail-toolbar \.archive-reopen-hint\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1/);
  assert.match(css, /\.archive-correction-page \.archive-detail-toolbar \.archive-reopen-hint[\s\S]*?background:\s*color-mix\(in srgb, var\(--primary-soft/);
  assert.match(css, /@media \(max-width: 540px\)[\s\S]*?\.archive-correction-page \.archive-detail-toolbar \.archive-reopen-hint/);
});

test('closed-month access explanation remains visible and receives readable card styling', () => {
  const page = read('src/features/archive/ArchiveCorrectionPage.jsx');
  const css = read('src/features/archive/archive-correction.css');
  assert.match(page, /archive-correction-access-note/);
  assert.match(page, /সম্পাদনা করতে পারবেন শুধু মাস বন্ধকারী/);
  assert.match(css, /\.archive-correction-page \.archive-correction-access-note\s*\{[\s\S]*?border-left:[\s\S]*?background:\s*linear-gradient/);
});

test('History page header is clean and the new History color system is theme-aware', () => {
  const page = read('src/features/history/HistoryPage.jsx');
  const css = read('src/styles/history-finish-v13.css');
  assert.doesNotMatch(page, /history-intro-guidance-box|সম্পাদনা শুধু যে অ্যাকাউন্ট মাসটি বন্ধ করেছে, সেই অ্যাকাউন্টের জন্য/);
  assert.match(page, /history-title-actions/);
  assert.match(css, /--history-blue-bg/);
  assert.match(css, /:root\[data-theme=\"blue\"\]/);
  assert.match(css, /:root\[data-theme=\"dark\"\]/);
});

test('history market cards receive dedicated visual classes without changing their click action', () => {
  const page = read('src/features/history/HistoryPage.jsx');
  assert.match(page, /history-item-card history-market-entry-card/);
  assert.match(page, /onClick=\{\(\) => onOpen\(row\.market_entry_id\)\}/);
  assert.match(page, /history-market-serial/);
  assert.match(page, /history-market-amount/);
  assert.match(page, /history-market-item-count/);
});

test('market card presentation improves hierarchy and keeps existing data fields', () => {
  const page = read('src/features/history/HistoryPage.jsx');
  const css = read('src/features/history/history-page-visual-refinement.css');
  assert.match(page, /row\.buyer_name \|\| 'বাজারকারী'/);
  assert.match(page, /row\.created_by_name \|\| 'নাম সংরক্ষিত নেই'/);
  assert.match(page, /row\.updated_by_name/);
  assert.match(page, /row\.credit_to_buyer \? 'জমায় যুক্ত' : 'জমায় নয়'/);
  assert.match(css, /\.history-list \.history-market-entry-card\s*\{/);
  assert.match(css, /\.history-market-amount\s*\{/);
  assert.match(css, /\.history-market-item-count/);
});

test('history market cards remain responsive on narrow phones and respect reduced motion', () => {
  const css = read('src/features/history/history-page-visual-refinement.css');
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.history-list \.history-market-entry-card/);
  assert.match(css, /@media \(max-width: 380px\)[\s\S]*?\.history-market-amount-value > strong[\s\S]*?font-size:\s*12\.5px/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('history-only styling is imported from the history page and does not alter global style entry points', () => {
  const page = read('src/features/history/HistoryPage.jsx');
  const main = read('src/main.jsx');
  assert.match(page, /import '\.\/history-page-visual-refinement\.css';/);
  assert.doesNotMatch(main, /history-page-visual-refinement/);
});
