import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getDhakaBusinessDate } from '../src/utils/periodMessaging.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function between(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing section start: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section end: ${end}`);
  return source.slice(from, to);
}

test('Dhaka business date is used rather than the browser local calendar date', () => {
  assert.equal(getDhakaBusinessDate(new Date('2026-11-10T18:30:00.000Z')), '2026-11-11');
});

test('Khala entry form permits a payment date after the selected accounting month through Dhaka today', () => {
  const manager = read('src/features/manager/ManagerPages.jsx');
  const page = between(manager, 'export function KhalaMoneyPage()', 'export function ');
  assert.match(page, /const paymentDateMax = getDhakaBusinessDate\(\)/);
  assert.match(page, /max=\{paymentDateMax\}/);
  assert.match(page, /min=\{selectedPeriod\?\.start_date \|\| undefined\}/);
  assert.match(page, /const dhakaToday = getDhakaBusinessDate\(\)/);
  assert.match(page, /form\.paymentDate > dhakaToday/);
  assert.match(page, /form\.paymentDate < String\(selectedPeriod\.start_date\)/);
  assert.doesNotMatch(page, /form\.paymentDate > selectedPeriod\?\.end_date/);
  assert.doesNotMatch(page, /এই খরচটি খালার আলাদা হিসাব হবে|আজ পরিশোধ করলেও এন্ট্রিটি/);
  assert.match(page, /প্রকৃত প্রদানের তারিখ:/);
  const memberView = read('src/features/menu/MenuPages.jsx');
  assert.match(memberView, /প্রকৃত প্রদানের তারিখ:\s*\{formatDateWithWeekday\(row\.entry_date\)\}/);
});

test('Khala add and edit migration preserves the selected period and removes only the month-end payment-date ceiling', () => {
  const sql = read('supabase/migrations/Run42_khala_payment_date_after_selected_month.sql');
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\._hl_original_manager_add_khala_money_for_period/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.manager_update_khala_money/);
  assert.match(sql, /private\.can_manage_khala_period\(v_period\.hostel_id,v_period\.id\)/);
  assert.match(sql, /p_payment_date<v_period\.start_date/);
  assert.match(sql, /p_payment_date>v_today/);
  assert.match(sql, /INSERT INTO public\.khala_money_entries/);
  assert.match(sql, /UPDATE public\.khala_money_entries/);
  assert.match(sql, /INSERT INTO public\.archive_period_audit/);
  assert.match(sql, /'payment_date_after_period_end'/);
  assert.doesNotMatch(sql, /p_payment_date\s*>\s*COALESCE\(v_period\.khala_entry_end_date/);
  assert.doesNotMatch(sql, /ALTER TABLE public\.khala_money_entries/);
  assert.doesNotMatch(sql, /DROP POLICY|CREATE POLICY|ALTER POLICY/);
});

test('migration has fail-closed preflight for wrapper, recipient trigger, security definer and incompatible date checks', () => {
  const sql = read('supabase/migrations/Run42_khala_payment_date_after_selected_month.sql');
  assert.match(sql, /Run16\/Run20\/Run39 Khala helpers or RPC signatures are missing/);
  assert.match(sql, /Run16 recipient-safe add wrapper is not intact/);
  assert.match(sql, /active Run16\/Run20 recipient-preservation trigger is not present exactly once/);
  assert.match(sql, /Khala write RPC security-definer configuration differs/);
  assert.match(sql, /a table CHECK constraint references payment_date/);
  assert.match(sql, /SET LOCAL lock_timeout = '5s'/);
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /COMMIT;/);
});

test('verification script is read-only and checks both write functions and recipient trigger', () => {
  const verify = read('supabase/verify/Verify_Run42_khala_payment_date_after_selected_month.sql');
  assert.match(verify, /pg_get_functiondef/);
  assert.match(verify, /can_manage_khala_period/);
  assert.match(verify, /archive_period_audit/);
  assert.match(verify, /hl_preserve_khala_recipient_on_insert/);
  assert.doesNotMatch(verify, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\s+(INTO|TABLE|POLICY|FUNCTION|TRIGGER)/i);
});
