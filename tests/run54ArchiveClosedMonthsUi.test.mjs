import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('closed-month hero guidance spans the archive header instead of being constrained to the title column', () => {
  const page = read('src/features/archive/ArchiveCorrectionPage.jsx');
  const css = read('src/features/archive/archive-correction.css');
  assert.match(page, /<div className="archive-hero-main">[\s\S]*?<\/div>\s*<div className="archive-hero-actions">[\s\S]*?<\/div>\s*<div className="archive-hero-guidance">/);
  assert.match(css, /\.archive-correction-page \.archive-hero-guidance\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.archive-correction-page \.archive-hero-guidance\s*\{\s*grid-column:\s*1/);
});

test('closed-month guidance and access notice use active theme tokens and compact responsive sizing', () => {
  const css = read('src/features/archive/archive-correction.css');
  assert.match(css, /var\(--primary-soft/);
  assert.match(css, /var\(--archive-card\)/);
  assert.match(css, /\.archive-correction-page \.archive-correction-access-note\s*\{[\s\S]*?display:\s*block/);
  assert.match(css, /@media \(max-width: 540px\)[\s\S]*?\.archive-correction-page \.archive-correction-access-note/);
});

test('redundant archive landing instructions are removed while month identity and access status remain', () => {
  const page = read('src/features/archive/ArchiveCorrectionPage.jsx');
  assert.doesNotMatch(page, /বন্ধ হিসাব<\/small>|একটি মাস নির্বাচিত|মাস বেছে নিন|রিড-অনলি<\/small>/);
  assert.doesNotMatch(page, /যে মাসের হিসাব দেখতে চান সেটি খুলুন|বন্ধ মাস · রিপোর্ট দেখতে খুলুন|ফিল্টার চালু/);
  assert.match(page, /মাস বন্ধ করেছেন: \{row\.manager_at_close_name\}/);
  assert.match(page, /row\.can_edit \? 'আপনি মাসটি বন্ধ করেছেন' : 'শুধু দেখা · লক'/);
});

test('archive detail retains the essential closer-only permission explanation without a decorative icon column', () => {
  const page = read('src/features/archive/ArchiveCorrectionPage.jsx');
  assert.match(page, /archive-correction-access-note"><div><strong>/);
  assert.match(page, /সম্পাদনা করতে পারবেন শুধু মাস বন্ধকারী/);
  assert.match(page, /প্রতিটি সংশোধনের কারণ ও পরিবর্তন অডিট লগে সংরক্ষিত হবে/);
  assert.doesNotMatch(page, /archive-note-icon/);
});

test('empty archive states and empty report categories do not repeat small helper paragraphs', () => {
  const page = read('src/features/archive/ArchiveCorrectionPage.jsx');
  assert.match(page, /const Empty = \(\{ title \}\)/);
  assert.doesNotMatch(page, /অন্য মাসের নাম বা তারিখ দিয়ে চেষ্টা করুন|একটি মাস বন্ধ হলে সেটি এখানে সংরক্ষিত হবে/);
  assert.doesNotMatch(page, /বিস্তারিত দেখতে উপরের বিভাগ নির্বাচন করুন/);
});
