import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const dashboard = read('src/features/dashboard/DashboardPage.jsx');
const offlineStore = read('src/services/offlineStore.js');
const dashboardService = read('src/services/dashboardService.js');
const sevenStore = read('src/services/sevenDayMealStore.js');

test('the existing dashboard snapshot persists the complete meal card in IndexedDB', () => {
  assert.match(offlineStore, /meal_card:\s*dashboard\.meal_card\s*\|\|\s*null/);
  assert.match(offlineStore, /await put\(DASHBOARD_STORE,/);
  assert.match(offlineStore, /objectStore\(storeName\)\.put\(record\)/);
});

test('today meal details use cached member rows offline and do not call the detail RPC', () => {
  const openDetails = dashboard.slice(dashboard.indexOf('const openDetails = useCallback'), dashboard.indexOf('const openMember = useCallback'));
  assert.match(openDetails, /if \(!online\)/);
  assert.match(openDetails, /selectedMeal\?\.member_details/);
  assert.ok(openDetails.indexOf('return;') < openDetails.indexOf('await fetchMealDetails(date)'));
});

test('late-request card reads the cached meal-card late_requests payload', () => {
  assert.match(dashboard, /meal\?\.late_requests/);
  assert.match(dashboard, /<LateRequestCard meal=\{mealCard\}/);
});

test('seven-day snapshot is scoped by user and hostel and can be read without network', () => {
  assert.match(sevenStore, /localStorage\.setItem\(storageKey\(userId, hostelId\)/);
  assert.match(sevenStore, /localStorage\.getItem\(storageKey\(userId, hostelId\)/);
  assert.match(dashboard, /if \(!userId \|\| !hostelId \|\| !online\) return null/);
});

test('seven-day refresh is a cached read-only SELECT, not an RPC or a write', () => {
  const query = dashboardService.slice(dashboardService.indexOf('export async function fetchUpcomingMealOverview'), dashboardService.indexOf('export async function fetchMemberPeriodDetails'));
  assert.match(query, /\.from\('daily_meal_records'\)/);
  assert.match(query, /\.select\(/);
  assert.match(query, /ttlMs:\s*60000/);
  assert.doesNotMatch(query, /\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
});
