import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMarketShareText, readMarketShareSummary } from '../src/utils/marketShare.js';

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test('market share summary restores on same-tab navigation and clears on browser refresh', () => {
  const storage = makeStorage({ summary: JSON.stringify({ text: 'saved market', savedAt: 123456 }) });
  assert.deepEqual(readMarketShareSummary({ storage, storageKey: 'summary', navigationType: 'navigate' }), {
    text: 'saved market', savedAt: 123456,
  });
  assert.equal(readMarketShareSummary({ storage, storageKey: 'summary', navigationType: 'reload' }), null);
  assert.equal(storage.getItem('summary'), null);
});

test('market share summary rejects malformed or incomplete session data', () => {
  const storage = makeStorage({ summary: '{bad json' });
  assert.equal(readMarketShareSummary({ storage, storageKey: 'summary', navigationType: 'back_forward' }), null);
  assert.equal(storage.getItem('summary'), null);
});

test('market share text keeps the expected Bengali date, buyer and total labels', () => {
  const text = buildMarketShareText({ entryDate: '2026-11-06', buyerName: 'Md Rakibul', items: [{ item_name: 'চাল', quantity: '২ কেজি', amount: 120 }], total: 120 });
  assert.match(text, /তারিখ :/);
  assert.match(text, /বাজারকারী: Rakibul/);
  assert.match(text, /চাল ২ কেজি/);
  assert.match(text, /টোটাল বাজার =/);
});
