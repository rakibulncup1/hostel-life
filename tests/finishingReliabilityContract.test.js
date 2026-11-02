import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/Run10.sql', import.meta.url), 'utf8');
const dining = await readFile(new URL('../src/features/dining/DiningPage.jsx', import.meta.url), 'utf8');
const manager = await readFile(new URL('../src/features/manager/ManagerPages.jsx', import.meta.url), 'utf8');
const platform = await readFile(new URL('../src/features/platform/SuperAdminPage.jsx', import.meta.url), 'utf8');
const profile = await readFile(new URL('../src/features/profile/ProfilePage.jsx', import.meta.url), 'utf8');
const profileService = await readFile(new URL('../src/services/profileService.js', import.meta.url), 'utf8');
const notifications = await readFile(new URL('../src/components/NotificationsPopover.jsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles/ui-refresh.css', import.meta.url), 'utf8');

test('manager meal requests require a running period and clear historical rows otherwise', () => {
  const page = dining.slice(dining.indexOf('function ManagerMealRequests()'));
  assert.match(page, /fetchRunningPeriod\(\{ force: true \}\)/);
  assert.match(page, /if \(!activePeriod\)\s*\{\s*setRequests\(\[\]\)/);
  assert.match(page, /কোনো চলমান মাস নেই/);
  assert.match(page, /tables: \[[^\]]*'monthly_periods'/);
});

test('Khala transaction history displays the identity returned by the server', () => {
  assert.match(manager, /এন্ট্রি করেছেন:\s*\{row\.created_by_name \|\| row\.creator_name/);
  assert.match(migration, /'created_by_name', COALESCE\(NULLIF\(btrim\(p\.full_name\), ''\), 'নাম পাওয়া যায়নি'\)/);
});

test('assistant-manager picker has distinct selected-state cards and responsive styles', () => {
  assert.match(manager, /assistant-selection-count/);
  assert.match(manager, /assistant-choice-state/);
  assert.match(styles, /\.assistant-choice-card\.selected/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.assistant-grid \{ grid-template-columns: minmax\(0, 1fr\)/);
});

test('avatar chooser resets the file before opening and format hint avoids compression claims', () => {
  assert.match(profile, /fileRef\.current\.value = '';/);
  assert.match(profile, /ছবির ফরম্যাট: JPG, PNG, WEBP/);
  assert.doesNotMatch(profile, /১৯০ KB-এর মধ্যে compress হবে|স্বয়ংক্রিয়ভাবে.*compress/i);
  assert.match(profileService, /MIME_BY_EXTENSION/);
  assert.match(profileService, /loadImage\(file\)/);
});

test('notification RPC migration physically deletes recipient-owned rows and purges prior tombstones', () => {
  assert.match(migration, /DELETE FROM public\.notifications\s+WHERE id = p_notification_id AND recipient_user_id = auth\.uid\(\)/);
  assert.match(migration, /DELETE FROM public\.notifications WHERE deleted_at IS NOT NULL/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.delete_all_my_notifications\(\)[\s\S]*?DELETE FROM public\.notifications WHERE recipient_user_id = auth\.uid\(\)/);
  assert.doesNotMatch(migration, /UPDATE public\.notifications SET deleted_at\s*=/i);
  assert.match(notifications, /স্থায়ীভাবে মুছে/);
});

test('hostel purge removes summary foreign-key blockers and preserves accounts used by other hostels', () => {
  const deleteFn = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.platform_admin_permanently_delete_hostel'));
  assert.match(deleteFn, /DELETE FROM public\.hl_period_summary_snapshots WHERE hostel_id = \$1/);
  assert.match(deleteFn, /DELETE FROM public\.hl_archived_final_summaries WHERE hostel_id = \$1/);
  assert.ok(deleteFn.indexOf('DELETE FROM public.hl_period_summary_snapshots') < deleteFn.indexOf('DELETE FROM public.hostels'));
  assert.match(deleteFn, /NOT EXISTS \(SELECT 1 FROM public\.hostel_memberships m WHERE m\.user_id = u\.id\)/);
});

test('retention page keeps successful lists when a sibling RPC fails and requires a verified summary for purge', () => {
  assert.match(platform, /Promise\.allSettled\(\[/);
  assert.match(platform, /expiredArchivesLoaded/);
  assert.match(platform, /মেয়াদোত্তীর্ণ আর্কাইভ \(\{expiredArchives\.length\}\)/);
  assert.match(platform, /!row\.purged_at && row\.verified_at/);
  assert.match(migration, /\(s\.verified_at IS NOT NULL AND s\.purged_at IS NULL\) AS summary_verified/);
  assert.match(migration, /'verified_at', s\.verified_at/);
});

test('reopen action is limited to an accidental close in the current calendar month', () => {
  assert.match(migration, /date_trunc\('month', v_period\.start_date::timestamp\) <> date_trunc\('month', v_today::timestamp\)/);
  assert.match(migration, /IF EXISTS \(SELECT 1 FROM public\.monthly_periods WHERE hostel_id = v_hostel AND status = 'running'\)/);
  assert.match(migration, /later\.start_date > v_period\.start_date/);
  assert.match(manager, /selected\?\.can_reopen/);
});

test('saved archive summaries preserve the entire JSONB array returned by Supabase', async () => {
  const service = await readFile(new URL('../src/services/platformService.js', import.meta.url), 'utf8');
  const listStart = service.indexOf('export async function platformAdminListSavedSummaries()');
  const nextFunction = service.indexOf('\nexport async function', listStart + 1);
  const listFunction = service.slice(listStart, nextFunction > listStart ? nextFunction : undefined);
  assert.match(listFunction, /return Array\.isArray\(data\) \? data : \[\]/);
  assert.doesNotMatch(listFunction.replace(/\/\/.*$/gm, ''), /firstRow\(data\)/);
});
