import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMarketPaste, sanitizeMarketInput } from '../src/utils/marketPaste.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('market paste keeps Unicode symbols and punctuation in a single item name', () => {
  const parsed = parseMarketPaste('রুই মাছ — ১.৫ কেজি 🐟 / Fresh!');
  assert.equal(parsed.mode, 'single');
  assert.equal(parsed.itemName, 'রুই মাছ — ১.৫ কেজি 🐟 / Fresh!');
});

test('market paste turns a plain multi-line list into separate item rows', () => {
  const parsed = parseMarketPaste('চাল\nডাল\nআলু-পেঁয়াজ');
  assert.equal(parsed.mode, 'rows');
  assert.deepEqual(parsed.items, [
    { item_name: 'চাল', quantity: '', amount: '' },
    { item_name: 'ডাল', quantity: '', amount: '' },
    { item_name: 'আলু-পেঁয়াজ', quantity: '', amount: '' },
  ]);
});

test('market paste imports tab-separated item, quantity and Bengali currency values', () => {
  const parsed = parseMarketPaste('চাল\t৫ কেজি\t৳১,২০০.৫০\nডাল\t২ কেজি\t২৫০');
  assert.equal(parsed.mode, 'rows');
  assert.deepEqual(parsed.items, [
    { item_name: 'চাল', quantity: '৫ কেজি', amount: '1200.50' },
    { item_name: 'ডাল', quantity: '২ কেজি', amount: '250' },
  ]);
});

test('market paste ignores a spreadsheet header and optional serial number column', () => {
  const parsed = parseMarketPaste('আইটেমের নাম\tপরিমাণ\tটাকার পরিমাণ\n১\tমাছ (ইলিশ)\t২টি\t১৫০০');
  assert.deepEqual(parsed.items, [
    { item_name: 'মাছ (ইলিশ)', quantity: '২টি', amount: '1500' },
  ]);
});


test('market paste accepts a spreadsheet header with a serial-number column', () => {
  const parsed = parseMarketPaste('ক্রম\tআইটেমের নাম\tপরিমাণ\tটাকার পরিমাণ\n১\tডিম\t১২টি\t১৮০');
  assert.deepEqual(parsed.items, [
    { item_name: 'ডিম', quantity: '১২টি', amount: '180' },
  ]);
});

test('market paste rejects malformed amounts and overlong names safely', () => {
  assert.match(parseMarketPaste('চাল\t৫ কেজি\tদুইশ টাকা').error, /টাকার ঘরে/);
  assert.match(parseMarketPaste(`${'ক'.repeat(161)}\nডাল`).error, /১৬০/);
  assert.match(parseMarketPaste('চাল\t২ কেজি\t১২,৩৪').error, /টাকার ঘরে/);
});

test('market input sanitation removes control characters but preserves text symbols', () => {
  assert.equal(sanitizeMarketInput('চাল\u0000— ডাল ✓'), 'চাল— ডাল ✓');
});

test('auth and onboarding public screens respect the saved theme without changing the BrandMark', () => {
  const auth = fs.readFileSync(path.join(root, 'src/features/auth/AuthPage.jsx'), 'utf8');
  const onboarding = fs.readFileSync(path.join(root, 'src/features/onboarding/OnboardingPage.jsx'), 'utf8');
  assert.match(auth, /applyTheme\(getThemePreference\(\)\)/);
  assert.match(onboarding, /applyTheme\(getThemePreference\(\)\)/);
  assert.match(auth, /<EntryThemeSwitcher/);
  assert.match(onboarding, /<EntryThemeSwitcher/);
  assert.match(auth, /<BrandMark size=\{64\}/);
  assert.match(onboarding, /<BrandMark size=\{62\}/);
  assert.match(auth, /অ্যাকাউন্ট যাচাই ও পাসওয়ার্ড পুনরুদ্ধারের জন্য সচল ইমেইল ব্যবহার করুন/);
});

test('hostel notice migration scopes the banner to one hostel and limits it to managers', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/Run21_hostel_pinned_manager_notices.sql'), 'utf8');
  assert.match(sql, /hostel_pinned_announcements/);
  assert.match(sql, /hostel_id uuid PRIMARY KEY REFERENCES public\.hostels\(id\) ON DELETE CASCADE/);
  assert.match(sql, /private\.assert_hostel_manager\(v_hostel, NULL, false, false\)/);
  assert.match(sql, /announcement_batch_id/);
  assert.match(sql, /manager_clear_hostel_pinned_announcement/);
  assert.match(sql, /REVOKE ALL ON public\.hostel_pinned_announcements FROM PUBLIC, anon, authenticated/);
});

test('pinned manager notice is loaded by current hostel rather than recipient inbox rows', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/Run21_hostel_pinned_manager_notices.sql'), 'utf8');
  const appShell = fs.readFileSync(path.join(root, 'src/app/AppShell.jsx'), 'utf8');
  assert.match(sql, /WHERE a\.hostel_id = v_hostel/);
  assert.match(sql, /manager_clear_hostel_pinned_announcement/);
  assert.match(appShell, /fetchPinnedManagerAnnouncement\(\)/);
  assert.match(appShell, /মেসের ম্যানেজারের বার্তা/);
});

test('bulk market import caps a paste at 100 rows before creating inputs', () => {
  const paste = Array.from({ length: 101 }, (_, i) => `আইটেম ${i + 1}`).join('\n');
  assert.match(parseMarketPaste(paste).error, /১০০টি/);
});
