import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const service = readFileSync(new URL('../src/services/archiveCorrectionService.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/features/archive/ArchiveCorrectionPage.jsx', import.meta.url), 'utf8');

test('module 1 uses distinct correction RPCs and not legacy reopen as write fallback', () => {
 assert.match(service, /hlc_get_archive_correction_bundle/);
 assert.match(service, /hlc_apply_archive_correction/);
 assert.doesNotMatch(service, /rpc\(['\"](?:reopen_archived_period|grant_archive_edit_permission)/);
 assert.match(ui, /backendMissing/);
});
test('archive page requires manager, reason and remains period bound', () => {
 assert.match(ui, /isPrimaryManager/);
 assert.match(ui, /reason\.trim\(\)\.length < 8/);
 assert.match(ui, /periodId/);
});
