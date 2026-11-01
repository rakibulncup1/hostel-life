import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const sql = read('supabase/migrations/Run25_super_admin_hostel_insights.sql');
const page = read('src/features/platform/SuperAdminPage.jsx');
const service = read('src/services/platformService.js');
const css = read('src/styles/ui-refresh.css');
const icons = read('src/components/Icon.jsx');

test('Super Admin has a hostel insights tab with hostel and period selectors', () => {
  assert.match(page, /\['insights','মেস ইনসাইটস'\]/);
  assert.match(page, /মেস নির্বাচন/);
  assert.match(page, /মাস নির্বাচন/);
  assert.match(page, /platformAdminGetHostelInsights/);
});

test('insights UI displays aggregate meal, market, deposit and expense metrics', () => {
  for (const key of [
    'finalized_breakfast','finalized_lunch','finalized_dinner','finalized_meals_total',
    'market_total','cash_deposit_total','market_credit_total','other_expense_total',
    'khala_expense_total','adjustment_net','operating_expense_total','meal_rate',
    'finalized_days','pending_meal_requests'
  ]) assert.ok(page.includes(key), `missing UI binding ${key}`);
  assert.match(page, /ব্যক্তিগত সদস্যের লেনদেন এখানে প্রকাশ করা হয় না/);
});

test('service calls only the dedicated aggregate insights RPC', () => {
  assert.match(service, /platform_admin_get_hostel_insights/);
  assert.match(service, /p_hostel_id:\s*hostelId/);
  assert.match(service, /p_period_id:\s*periodId\s*\|\|\s*null/);
});

test('insights RPC is super-admin-only, SECURITY DEFINER and search_path hardened', () => {
  assert.match(sql, /FUNCTION public\.platform_admin_get_hostel_insights\([\s\S]*?p_hostel_id uuid,[\s\S]*?p_period_id uuid DEFAULT NULL/);
  assert.match(sql, /PERFORM private\.assert_signed_in\(\);[\s\S]*?IF NOT private\.is_super_admin\(\) THEN/);
  assert.match(sql, /SECURITY DEFINER\s+SET search_path = ''/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.platform_admin_get_hostel_insights\(uuid,uuid\) FROM PUBLIC, anon/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.platform_admin_get_hostel_insights\(uuid,uuid\) TO authenticated/);
});

test('live insight meals are limited to finalized days and non-cancelled rows', () => {
  assert.match(sql, /d\.status='finalized' AND NOT r\.cancelled/);
  assert.match(sql, /COALESCE\(r\.final_breakfast,r\.actual_breakfast,r\.planned_breakfast,0\)/);
  assert.match(sql, /COALESCE\(r\.final_lunch,r\.actual_lunch,r\.planned_lunch,0\)/);
  assert.match(sql, /COALESCE\(r\.final_dinner,r\.actual_dinner,r\.planned_dinner,0\)/);
});

test('financial aggregates keep cash deposits and market credits separate and exclude void rows', () => {
  assert.match(sql, /l\.ledger_type='deposit' AND l\.amount>0/);
  assert.match(sql, /l\.ledger_type='market_deposit' AND l\.amount>0/);
  assert.match(sql, /l\.status='active'/);
  assert.match(sql, /e\.status='active'/);
  assert.match(sql, /k\.status='active'/);
  assert.match(sql, /v_operating_expenses := v_market_total\+v_other_expense\+v_khala_total/);
});

test('purged archive detail is served from the retained aggregate summary with an explicit marker', () => {
  assert.match(sql, /hl_archived_final_summaries s[\s\S]*?s\.purged_at IS NOT NULL/);
  assert.match(sql, /'snapshot_only',true/);
  assert.match(sql, /'source',CASE WHEN v_period_found THEN 'live_detail' ELSE 'saved_archive' END/);
  assert.match(page, /সংরক্ষিত Aggregate Summary/);
});

test('RPC is aggregate-only and does not return individual member or transaction rows', () => {
  assert.doesNotMatch(sql, /jsonb_agg\(jsonb_build_object\([^;]*(member_name|member_email|transaction_id)/i);
  assert.doesNotMatch(sql, /'member_rows'|'transaction_rows'|'member_details'/i);
  assert.match(page, /সদস্যভিত্তিক হিসাব গোপন/);
});

test('every new insight metric uses an icon supported by the app icon map', () => {
  const used = [...page.matchAll(/<InsightStat[^>]*icon=\"([^\"]+)\"/g)].map((match) => match[1]);
  assert.ok(used.length >= 10);
  for (const name of used) assert.ok(icons.includes(`'${name}':`) || icons.includes(` ${name}:`), `unsupported icon: ${name}`);
});

test('insights panel has responsive layouts for desktop and mobile', () => {
  assert.match(css, /\.platform-insights-grid\s*\{[^}]*repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:640px\)[\s\S]*?\.platform-insights-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test('Run25 is non-destructive: no schema, row, or policy deletion/alteration', () => {
  assert.doesNotMatch(sql, /\bCREATE\s+TABLE\b/i);
  assert.doesNotMatch(sql, /\bALTER\s+TABLE\b/i);
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  assert.match(sql, /Run after Run24/);
});
