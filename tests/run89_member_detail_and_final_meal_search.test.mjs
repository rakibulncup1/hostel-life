import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  filterFinalMealMembers,
  MAX_FINAL_MEAL_BATCH_SIZE,
  normalizeFinalMealMemberSearch,
  resolveFinalMealMemberTargets,
} from '../src/utils/finalMealMemberSearch.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dining = fs.readFileSync(path.join(root, 'src/features/dining/DiningPage.jsx'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'src/features/dashboard/DashboardPage.jsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src/styles/run89-member-detail-and-final-meal-search.css'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8');

const members = [
  { membership_id: 'm1', member_name: 'Rakibul Islam', member_status: 'active' },
  { membership_id: 'm2', member_name: 'Samrat Hasan', member_status: 'active' },
  { membership_id: 'm3', member_name: 'রাকিবুল ইসলাম', member_status: 'active' },
  { membership_id: 'm4', member_name: 'Inactive Member', member_status: 'inactive' },
];

test('Run89 normalizes search text without altering member data', () => {
  assert.equal(normalizeFinalMealMemberSearch('  RAKIBUL   Islam  '), 'rakibul islam');
  assert.equal(normalizeFinalMealMemberSearch('１２３'), '123');
  assert.equal(normalizeFinalMealMemberSearch(null), '');
});

test('Run89 filters only active member names case-insensitively when called with active list', () => {
  const active = members.filter((member) => member.member_status === 'active');
  assert.deepEqual(filterFinalMealMembers(active, 'RAKIBUL').map((member) => member.membership_id), ['m1']);
  assert.deepEqual(filterFinalMealMembers(active, 'রাকিবুল').map((member) => member.membership_id), ['m3']);
});

test('Run89 empty search keeps the complete active member list', () => {
  const active = members.filter((member) => member.member_status === 'active');
  assert.deepEqual(filterFinalMealMembers(active, '   '), active);
});

test('Run89 no-match search returns an empty list', () => {
  assert.deepEqual(filterFinalMealMembers(members, 'does-not-exist'), []);
});

test('Run89 single-member mode always targets only the explicitly selected member', () => {
  const result = resolveFinalMealMemberTargets({
    mode: 'single', activeMembers: members, matchedMembers: [members[1]],
    selectedMemberId: 'm1', hasSearch: true,
  });
  assert.deepEqual(result.map((member) => member.membership_id), ['m1']);
});

test('Run89 all-member mode with no active search preserves previous active-member targeting', () => {
  const active = members.filter((member) => member.member_status === 'active');
  assert.deepEqual(resolveFinalMealMemberTargets({ mode: 'all', activeMembers: active }).map((m) => m.membership_id), ['m1', 'm2', 'm3']);
});

test('Run89 all-member search targets only visible matches, never hidden members', () => {
  const result = resolveFinalMealMemberTargets({
    mode: 'all', activeMembers: members, matchedMembers: [members[1]], hasSearch: true,
  });
  assert.deepEqual(result.map((member) => member.membership_id), ['m2']);
});

test('Run89 all-member search with no matches cannot accidentally target all members', () => {
  assert.deepEqual(resolveFinalMealMemberTargets({
    mode: 'all', activeMembers: members, matchedMembers: [], hasSearch: true,
  }), []);
});


test('Run89 honors the existing database RPC batch limit before saving', () => {
  assert.equal(MAX_FINAL_MEAL_BATCH_SIZE, 100);
  assert.match(dining, /const performSave = async \(payload\) => \{\s*if \(!Array\.isArray\(payload\) \|\| payload\.length === 0\)[\s\S]*?payload\.length > MAX_FINAL_MEAL_BATCH_SIZE/);
  assert.match(dining, /setManagerMealEntries\(payload\)/);
});

test('Run89 final meal editor provides one shared search for single and all-member modes', () => {
  assert.match(dining, /type="search"/);
  assert.match(dining, /সদস্যদের মধ্যে খুঁজুন/);
  assert.match(dining, /সদস্য খুঁজুন ও নির্বাচন করুন/);
  assert.match(dining, /role="status" aria-live="polite"/);
  assert.match(dining, /singleModeOptions\.map/);
});

test('Run89 save payload is scoped to search results while default-apply keeps its old all-member action', () => {
  assert.match(dining, /const buildPayload = \(force = true\) => \{\s*const targetMembers = scopedMembers;/);
  assert.match(dining, /খুঁজে পাওয়া \$\{formatNumber\(scopedMembers\.length\)\} জনের মিল সংরক্ষণ করুন/);
  assert.match(dining, /!scopedMembers\.length/);
  assert.ok(dining.includes('Object.fromEntries(activeMembers.map((member) => [member.membership_id, { ...current[member.membership_id], ...defaultMealDefaults }] ))'));
  assert.ok(dining.includes('সব সদস্যে প্রয়োগ করুন</button>'));
});

test('Run89 preserves existing final-meal permission, finalized-day and RPC checks', () => {
  assert.match(dining, /if \(!canManageFinalMeals\) return toast\.warning/);
  assert.match(dining, /dayStatus\.status !== 'finalized'/);
  assert.match(dining, /setManagerMealEntries\(payload\)/);
  assert.match(dining, /checkManagerMealEntryConflicts/);
});

test('Run89 modal uses equal-height metric tracks and vertical-only scrolling', () => {
  assert.match(styles, /overflow-x:\s*hidden\s*!important/);
  assert.match(styles, /overflow-y:\s*auto\s*!important/);
  assert.match(styles, /grid-auto-rows:\s*minmax\(92px,\s*auto\)/);
  assert.match(styles, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /width:\s*auto\s*!important/);
  assert.match(dashboard, /member-period-detail-modal/);
  const modalSelectors = styles.split('{').slice(0, -1).map((part) => part.trim().split('\n').at(-1).trim()).filter((selector) => selector.includes('member-period-detail-modal'));
  assert.ok(modalSelectors.length >= 8);
  for (const selector of modalSelectors) assert.ok(selector.startsWith('.dashboard-reimagined '), `Unscoped member modal selector: ${selector}`);
});

test('Run89 stylesheet is loaded last and all meal-search selectors are Dining-scoped', () => {
  assert.ok(main.lastIndexOf("import './styles/run89-member-detail-and-final-meal-search.css';") > main.lastIndexOf("import './styles/run88-auth-brand-and-forgot-layout.css';"));
  const selectors = styles.split('{').slice(0, -1).map((part) => part.trim().split('\n').at(-1).trim()).filter((selector) => selector.includes('manager-final-member-search'));
  assert.ok(selectors.length >= 6);
  for (const selector of selectors) assert.match(selector, /:is\(\.dining-experience,\s*\.dining-stack\)/);
});
