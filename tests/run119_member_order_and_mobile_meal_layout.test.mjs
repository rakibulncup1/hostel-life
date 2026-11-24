import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  compareMembersByOrder,
  hasMemberOrderChanged,
  moveMemberWithinOrder,
  sortMembersByOrder,
} from '../src/utils/memberOrdering.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('saved member order is primary and alphabetical order is only a legacy fallback', () => {
  const members = [
    { membership_id: 'c', member_name: 'চয়ন', member_order: 3 },
    { membership_id: 'a', member_name: 'আলম', member_order: 1 },
    { membership_id: 'b', member_name: 'বাবু', member_order: 2 },
  ];
  assert.deepEqual(sortMembersByOrder(members).map((row) => row.membership_id), ['a', 'b', 'c']);
  assert.equal(compareMembersByOrder({ member_name: 'আলম' }, { member_name: 'বাবু' }) < 0, true);
});

test('member order controls move one place at a time without mutating source rows', () => {
  const rows = [{ membership_id: 'a' }, { membership_id: 'b' }, { membership_id: 'c' }];
  const moved = moveMemberWithinOrder(rows, 'c', -1);
  assert.deepEqual(moved.map((row) => row.membership_id), ['a', 'c', 'b']);
  assert.deepEqual(rows.map((row) => row.membership_id), ['a', 'b', 'c']);
  assert.equal(hasMemberOrderChanged(moved, ['a', 'b', 'c']), true);
  assert.equal(hasMemberOrderChanged(rows, ['a', 'b', 'c']), false);
});

test('member ordering is exposed from the directory and saved only through manager RPC', async () => {
  const [migration, service, settings] = await Promise.all([
    read('../supabase/migrations/Run97_member_order_manager_settings.sql'),
    read('../src/services/managerService.js'),
    read('../src/features/manager/ManagerPages.jsx'),
  ]);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS member_order integer/i);
  assert.match(migration, /jsonb_build_object\([\s\S]*?'member_order',\s*m\.member_order/i);
  assert.match(migration, /ORDER BY x\.member_order NULLS LAST/i);
  assert.match(migration, /private\.assert_hostel_manager\(v_hostel,v_period_id,false,false\)/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.manager_save_hostel_member_order\(uuid\[\]\) FROM PUBLIC, anon/i);
  assert.match(service, /manager_save_hostel_member_order/);
  assert.match(settings, /function MemberOrderSettings\(\)/);
  assert.match(settings, /<MemberOrderSettings \/>/);
  assert.match(settings, /saveHostelMemberOrder\(ids\)/);
  assert.match(settings, /ManagerGuard/);
});

test('mobile member-based final meal cards stack and keep Bengali labels on one line', async () => {
  const css = await read('../src/styles/dining-experience-v2.css');
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.manager-meal-grid\.member-final-day-meals[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s*!important/i);
  assert.match(css, /member-final-day-meals \.meal-stepper-row > span[\s\S]*?white-space:\s*nowrap\s*!important/i);
  assert.match(css, /member-final-day-meals \.meal-stepper[\s\S]*?justify-self:\s*end/i);
});

test('dashboard, dining, member directory and history refresh the persisted order after changes', async () => {
  const [dashboard, dining, menu, history, diningService] = await Promise.all([
    read('../src/features/dashboard/DashboardPage.jsx'),
    read('../src/features/dining/DiningPage.jsx'),
    read('../src/features/menu/MenuPages.jsx'),
    read('../src/features/history/HistoryPage.jsx'),
    read('../src/services/diningService.js'),
  ]);
  assert.match(dashboard, /tables:\s*\[[^\]]*hostel_memberships/);
  assert.match(dashboard, /invalidateRequestCache\('dining:memberDirectory'\)/);
  assert.match(dining, /fetchManagerMemberDirectory\(\{ force \}\)/);
  assert.match(dining, /loadMembers\(\{ quiet: true, force: true \}\)/);
  assert.match(menu, /fetchMemberDirectory\(\{ force \}\)/);
  assert.match(menu, /load\(\{ silent: true, force: true \}\)/);
  assert.match(history, /fetchMemberDirectory\(\{ force: true \}\)/);
  assert.match(diningService, /fetchManagerMemberDirectory\(options = \{\}\)/);
});

test('ordinary live and archived reports preserve member order without changing ranking queries', async () => {
  const [reports, manager, archiveMigration, rankings] = await Promise.all([
    read('../src/services/reportService.js'),
    read('../src/features/manager/ManagerPages.jsx'),
    read('../supabase/migrations/Run97_member_order_manager_settings.sql'),
    read('../src/services/rankingService.js'),
  ]);
  assert.match(reports, /buildMemberSettlementRows[\s\S]*?member_order:[\s\S]*?sort\(compareMembersByOrder\)/);
  assert.match(reports, /archivedMemberOrder[\s\S]*?sort\(compareMembersByOrder\)/);
  assert.match(manager, /liveMemberOrder[\s\S]*?sort\(compareMembersByOrder\)/);
  assert.match(archiveMigration, /'member_order',hm\.member_order/);
  assert.doesNotMatch(rankings, /member_order|sortMembersByOrder/);
});

test('Google library is warmed without preparing OAuth until consent is accepted', async () => {
  const auth = await read('../src/features/auth/AuthPage.jsx');
  const warmup = auth.match(/\/\/ Warm only Google's public button library[\s\S]*?\}, \[disabled, english\]\);/);
  assert.ok(warmup, 'public Google GIS library warm-up effect should exist');
  assert.match(warmup[0], /loadGoogleIdentityServices/);
  const warmupCode = warmup[0].replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(warmupCode, /prepareGoogleOAuth|initialize\(|nonce/);
  assert.match(auth, /if \(disabled \|\| !consentAccepted\)/);
  assert.match(auth, /prepareGoogleOAuth\([\s\S]*?eligibilityAccepted:\s*true/);
});

 test('member order changes do not sort by deposit or meal ranking', async () => {
  const manager = await read('../src/features/manager/ManagerPages.jsx');
  const ranking = await read('../src/services/rankingService.js');
  assert.match(manager, /MemberOrderSettings/);
  assert.match(ranking, /total_deposit/);
  assert.doesNotMatch(ranking, /member_order|sortMembersByOrder/);
});
