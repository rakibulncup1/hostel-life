import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const dashboard = read('src/features/dashboard/DashboardPage.jsx');
const styles = read('src/styles/dashboard-reimagined-original.css');
const migration = read('supabase/migrations/Run1.sql');
const dashboardService = read('src/services/dashboardService.js');

const mealFallback = dashboard.slice(
  dashboard.indexOf('const canUseCachedMealFallback'),
  dashboard.indexOf('const periodStartDate', dashboard.indexOf('const canUseCachedMealFallback')),
);

test('online meal fallback is limited to a same-day, same-period cached record while no live response exists', () => {
  assert.match(mealFallback, /online/);
  assert.match(dashboard, /const cachedMealMatchesLivePeriod = Boolean\(activePeriodId && cachedPeriodId && activePeriodId === cachedPeriodId\)/);
  assert.match(dashboard, /const cachedMealMatchesToday = String\(cachedMealCard\?\.meal_date \|\| ''\)\.slice\(0, 10\) === dhakaToday/);
  assert.match(mealFallback, /dashboardHasRunningPeriod/);
  assert.match(mealFallback, /!dashboard \|\| !dashboard\.meal_card/);
  assert.match(mealFallback, /dashboard\?\.meal_card \|\| \(canUseCachedMealFallback \? cachedMealCard : null\)/);
});

test('meal load errors keep a clear empty/error distinction and expose only a manual retry', () => {
  assert.match(dashboard, /মিলের তথ্য লোড করা যায়নি/);
  assert.match(dashboard, /আজকের মিলের তথ্য এখনো নেই/);
  assert.match(dashboard, /className="meal-retry-button" type="button" onClick=\{onRetry\}/);
  assert.match(dashboard, /const retryDashboard = useCallback\(\(\) => \{[\s\S]*invalidateRequestCache\('dashboard:data'\)[\s\S]*skipFallbackRefresh: true[\s\S]*skipUpcomingRefresh: true[\s\S]*\}, \[loadDashboard\]\)/);
  assert.match(dashboard, /const fallbackRefreshDue = !options\.skipFallbackRefresh/);
  assert.match(dashboard, /if \(!options\.skipUpcomingRefresh\)/);
  assert.doesNotMatch(dashboard, /setInterval\s*\(/);
});

test('failed refreshes preserve the last successfully loaded dashboard and explain that it is stale', () => {
  assert.match(dashboard, /latestDashboardRef\.current \|\| latestCachedDashboardRef\.current/);
  assert.match(dashboard, /সর্বশেষ সফলভাবে লোড করা তথ্য দেখানো হচ্ছে/);
  assert.match(dashboard, /\(dashboardError \|\| isCachedMealFallback\) && mealCard[\s\S]*dashboard-sync-recovery/);
  assert.match(dashboard, /dashboardError \? 'সর্বশেষ কপি' : loading \? 'সিঙ্ক হচ্ছে' : 'আপডেটেড'/);
});

test('member activity status shares the identity/role row instead of taking a separate line', () => {
  const memberCard = dashboard.slice(dashboard.indexOf('function MemberCard'), dashboard.indexOf('export function MemberPeriodDetailsModal'));
  assert.match(memberCard, /member-badge-row[\s\S]*ActivityBadge/);
  assert.doesNotMatch(memberCard, /<\/div>\s*<ActivityBadge/);
  assert.match(styles, /\.member-badge-row \.activity-badge[\s\S]*margin: 0 0 0 auto/);
});

test('light and sky themes retain readable contrast while dark theme uses muted nested surfaces', () => {
  assert.match(styles, /--dash-muted:\s*#4f6277/);
  assert.match(styles, /:root\[data-theme="blue"\][\s\S]*--dash-muted:\s*#526a80/);
  assert.match(styles, /:root\[data-theme="dark"\][\s\S]*background:\s*#24332d/);
  assert.match(styles, /:root\[data-theme="dark"\][\s\S]*background:\s*#262321/);
});

test('desktop finance panels align to equal height while mobile remains stacked naturally', () => {
  assert.match(styles, /@media \(min-width: 1020px\)[\s\S]*dashboard-finance-grid\.has-period-summary[\s\S]*align-items:\s*stretch/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*member-badge-row/);
});

test('member detail header has rounded upper corners in both Light and Dark themes', () => {
  assert.match(styles, /\.member-period-detail-modal > \.modal-head[\s\S]*border-top-left-radius:\s*17px[\s\S]*border-top-right-radius:\s*17px/);
  assert.match(styles, /:root\[data-theme="dark"\][\s\S]*\.member-period-detail-modal > \.modal-head/);
});

test('market item detail is fetched on member-open only, without a recurring frontend request', () => {
  const detailRead = dashboardService.slice(
    dashboardService.indexOf('export async function fetchMemberPeriodDetails'),
    dashboardService.indexOf('\n}', dashboardService.indexOf('export async function fetchMemberPeriodDetails')) + 2,
  );
  assert.match(detailRead, /supabase\.rpc\('get_member_period_details'/);
  const openMember = dashboard.slice(dashboard.indexOf('const openMember = useCallback'), dashboard.indexOf('const closeMemberDetail = useCallback'));
  assert.match(openMember, /await fetchMemberPeriodDetails\(memberId, activePeriodId/);
  assert.doesNotMatch(openMember, /setInterval|setTimeout|requestAnimationFrame/);
  assert.doesNotMatch(detailRead, /\.insert\(|\.update\(|\.delete\(/);
  const marketFunction = migration.slice(migration.indexOf('create or replace function public.get_member_period_details'), migration.indexOf('-- 06. Meal-request workflow', migration.indexOf('create or replace function public.get_member_period_details')));
  assert.match(marketFunction, /public\.market_entries/);
  assert.match(marketFunction, /public\.market_entry_items/);
  assert.match(marketFunction, /'quantity',i\.quantity,'amount',i\.amount/);
  assert.match(marketFunction, /perform private\.finalize_due_days/); // existing due-day logic is preserved, not replaced by this UI patch
});
