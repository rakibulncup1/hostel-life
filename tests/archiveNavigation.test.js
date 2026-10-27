import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const menu = readFileSync(new URL('../src/components/MenuDrawer.jsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/app/App.jsx', import.meta.url), 'utf8');
const archive = readFileSync(new URL('../src/features/archive/ArchiveCorrectionPage.jsx', import.meta.url), 'utf8');

test('hamburger menu exposes a single Archive option and no separate archive-edit-access row', () => {
  assert.equal((menu.match(/key: 'archive'/g) || []).length, 1);
  assert.doesNotMatch(menu, /key: 'archive-edit-access'/);
});

test('archive page lists closed months before opening a selected month and retains readonly report fallback', () => {
  assert.match(app, /pathname === '\/app\/menu\/archive'/);
  assert.match(archive, /সংরক্ষিত মাস/);
  assert.match(archive, /ReadOnlyReport detail=\{detail\}/);
  assert.match(archive, /শুধু দেখার অনুমতি/);
});
