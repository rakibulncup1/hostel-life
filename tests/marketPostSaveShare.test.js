import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMarketPaste } from '../src/utils/marketPaste.js';
import { buildMarketShareText, getMarketBuyerFirstName, readMarketShareSummary } from '../src/utils/marketShare.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const market = read('src/features/dining/DiningPage.jsx');
const css = read('src/styles/production-flow-finishing.css');
const migration = read('supabase/migrations/Run1.sql');

test('market share is no longer available before saving and opens only after create_market_entry resolves', () => {
  const form = market.slice(market.indexOf('function MarketEntryForm('), market.indexOf('function ManagerMealEntry('));
  const submitStart = form.indexOf('const submit = async');
  const savedAt = form.indexOf('setShareSummary(nextShareSummary)');
  assert.ok(submitStart >= 0 && savedAt > submitStart);
  assert.ok(form.indexOf('await createMarketEntry(') < savedAt);
  assert.doesNotMatch(form, /market-short-share/);
  assert.match(form, /<SystemNoticeDialog/);
  assert.match(form, /বাজারের তালিকা প্রস্তুত/);
});

test('successful market save refreshes member data quietly so the market form stays mounted for the share dialog', () => {
  const marketPage = read('src/features/dining/DiningPage.jsx');
  const marketFormStart = marketPage.indexOf("if (view === 'market')");
  const marketFormEnd = marketPage.indexOf("if (view === 'admin-entry')", marketFormStart);
  assert.ok(marketFormStart >= 0 && marketFormEnd > marketFormStart);
  const marketFormRoute = marketPage.slice(marketFormStart, marketFormEnd);
  assert.match(marketFormRoute, /onSaved=\{\(\) => loadMembers\(\{ quiet: true \}\)\}/);
  assert.doesNotMatch(marketFormRoute, /onSaved=\{loadMembers\}/);

  const loaderStart = marketPage.indexOf('const loadMembers = useCallback');
  const loaderEnd = marketPage.indexOf('}, [canOperateDining, periodFallback, toast]);', loaderStart);
  assert.ok(loaderStart >= 0 && loaderEnd > loaderStart);
  const loader = marketPage.slice(loaderStart, loaderEnd);
  assert.match(loader, /if \(!quiet\) setLoadingMembers\(true\)/);
  assert.match(loader, /if \(!quiet\) setLoadingMembers\(false\)/);
});

test('saved market summary uses the requested concise Bengali-only format and first buyer name', () => {
  const output = buildMarketShareText({
    entryDate: '2026-11-05',
    buyerName: 'মোঃ রাকিবুল ইসলাম সম্রাট',
    items: [
      { item_name: 'আলু', quantity: '২ কেজি', amount: 60 },
      { item_name: 'পেঁয়াজ', quantity: '১ কেজি', amount: 50 },
      { item_name: 'রসুন', quantity: 'আধা কেজি', amount: 60 },
    ],
    total: 170,
  });
  assert.match(output, /^তারিখ : ৫ নভেম্বর ২০২৬/m);
  assert.match(output, /^বাজারকারী: রাকিবুল$/m);
  assert.match(output, /^১\. আলু ২ কেজি ৬০ টাকা$/m);
  assert.match(output, /^২\. পেঁয়াজ ১ কেজি ৫০ টাকা$/m);
  assert.match(output, /^৩\. রসুন আধা কেজি ৬০ টাকা$/m);
  assert.match(output, /^টোটাল বাজার = ১৭০ টাকা$/m);
  assert.equal(getMarketBuyerFirstName('Rakibul Islam Samrat'), 'Rakibul');
  assert.doesNotMatch(output, /HOSTEL LIFE|৳/);
});
test('summary survives returning from native share but is cleared on a browser reload', () => {
  const form = market.slice(market.indexOf('function MarketEntryForm('), market.indexOf('function ManagerMealEntry('));
  assert.match(form, /sessionStorage\.setItem\(marketShareStorageKey/);
  assert.match(form, /sessionStorage\.removeItem\(marketShareStorageKey\)/);
  assert.match(form, /getEntriesByType\?\.\('navigation'\)/);
  assert.match(form, /await navigator\.share\(\{ title: 'Hostel Life · বাজারের তালিকা', text: shareSummary\.text \}\)/);
  assert.match(form, /if \(error\?\.name !== 'AbortError'\)/);

  const values = new Map();
  const storage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  const key = 'hostel-life:market-share-summary:test';
  const record = { text: 'তারিখ : ৫ নভেম্বর ২০২৬', savedAt: 1000 };
  storage.setItem(key, JSON.stringify(record));

  assert.deepEqual(readMarketShareSummary({ storage, storageKey: key, navigationType: 'navigate', now: 2000 }), record);
  assert.equal(storage.getItem(key) !== null, true, 'same-tab return keeps the summary');
  assert.equal(readMarketShareSummary({ storage, storageKey: key, navigationType: 'reload', now: 2000 }), null);
  assert.equal(storage.getItem(key), null, 'explicit reload clears the old summary');
});

test('market entry drafts remain memory-only and the share dialog uses only its header close control', () => {
  const form = market.slice(market.indexOf('function MarketEntryForm('), market.indexOf('function ManagerMealEntry('));
  assert.match(form, /useState\(\[\{ item_name: '', quantity: '', amount: '' \}\]\)/);
  assert.doesNotMatch(form, /market-entry-draft|marketEntryDraft|localStorage\.setItem/);
  const dialogStart = form.indexOf('{shareSummary?.text && <SystemNoticeDialog');
  const dialogEnd = form.indexOf('</SystemNoticeDialog>}', dialogStart);
  assert.ok(dialogStart >= 0 && dialogEnd > dialogStart);
  const dialog = form.slice(dialogStart, dialogEnd);
  assert.match(dialog, /onClose=\{closeShareSummary\}/);
  assert.doesNotMatch(dialog, /description=/);
  assert.doesNotMatch(dialog, /বন্ধ করুন/);
  assert.match(dialog, /শেয়ার করুন/);
  assert.match(dialog, /কপি করুন/);
});

test('plain multiline item-name paste is preserved as one item, while TSV still imports multiple rows', () => {
  const plain = parseMarketPaste('আগে কেনা বাজারের তালিকা\nচাল, ডাল ও আলু\nএকসঙ্গে হিসাব');
  assert.equal(plain.mode, 'single');
  assert.equal(plain.itemName, 'আগে কেনা বাজারের তালিকা\nচাল, ডাল ও আলু\nএকসঙ্গে হিসাব');
  const tsv = parseMarketPaste('চাল\t৫ কেজি\t৫০০\nডাল\t২ কেজি\t২০০');
  assert.equal(tsv.mode, 'rows');
  assert.equal(tsv.items.length, 2);
});

test('item name remains capped at the existing 160-character server validation limit', () => {
  const form = market.slice(market.indexOf('function MarketEntryForm('), market.indexOf('function ManagerMealEntry('));
  assert.match(form, /maxLength=\{?160\}?/);
  assert.match(migration, /length\(v_name\)>160/);
  assert.match(form, /textarea[\s\S]*?className="market-input-item"/);
  assert.match(css, /textarea\.market-input-item[\s\S]*?white-space: pre-wrap/);
});
