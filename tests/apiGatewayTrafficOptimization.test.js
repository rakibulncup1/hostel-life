import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Dashboard consumes period and member payload from one canonical RPC before using legacy fallbacks', () => {
  const page = read('src/features/dashboard/DashboardPage.jsx');
  const service = read('src/services/dashboardService.js');
  assert.match(page, /fetchDashboardData\(\{ force: Boolean\(options\.force\) \}\)/);
  assert.match(page, /Array\.isArray\(quickData\?\.members\)/);
  assert.match(page, /quickData\?\.has_running_period === false \? null/);
  assert.match(page, /import \{ fetchMemberDirectory, fetchRunningPeriod \}/);
  assert.doesNotMatch(service, /ensureRunningPeriodDays\(\)/);
});

test('Dashboard resume events reuse cache and do not invalidate fresh RPC payloads', () => {
  const page = read('src/features/dashboard/DashboardPage.jsx');
  assert.match(page, /minRefreshIntervalMs: 30000/);
  assert.match(page, /const isDatabaseChange = reason === 'realtime'/);
  assert.match(page, /if \(isDatabaseChange\) \{\s*invalidateRequestCache\('dashboard:data'\)/);
});

test('Management context uses bounded cache and trusts explicit no-running-period result', () => {
  const hook = read('src/hooks/useManagementContext.js');
  assert.match(hook, /ttlMs: 60000, force/);
  assert.match(hook, /data\?\.has_running_period === false/);
  assert.match(hook, /if \(document\.visibilityState === 'visible'\) refresh\(\)/);
  assert.match(hook, /ttlMs: 60000/);
});

test('Platform public settings use their existing cache on app resume', () => {
  const shell = read('src/app/AppShell.jsx');
  assert.match(shell, /loadSettings\(\);\s*const refreshLocal = \(\) => \{ loadSettings\(true\); \};/);
  assert.match(shell, /platformSettingsRefreshAtRef/);
  assert.doesNotMatch(shell, /const refreshWhenVisible = \(\) => \{[\s\S]*?loadSettings\(true\);/);
});

test('Notification reads are cached and writes invalidate that cache', () => {
  const service = read('src/services/notificationService.js');
  assert.match(service, /cachedRequest\(`notifications:inbox:\$\{limit\}`/);
  assert.match(service, /cachedRequest\('notifications:pinned-announcement'/);
  assert.equal((service.match(/invalidateRequestCache\('notifications:'\)/g) || []).length, 6);
});

test('Session security cadence is preserved; presence calls are throttled client-side', () => {
  const auth = read('src/contexts/AuthContext.jsx');
  assert.match(auth, /setInterval\(verifySessionPolicy, 60 \* 1000\)/);
  assert.match(auth, /SESSION_POLICY_CACHE_MS = 55 \* 1000/);
  assert.match(auth, /PRESENCE_TOUCH_MIN_INTERVAL_MS = 10 \* 60 \* 1000/);
  assert.match(auth, /setInterval\(touchPresence, 11 \* 60 \* 1000\)/);
});

test('Realtime data changes take priority over a queued focus/resume refresh', () => {
  const hook = read('src/hooks/useRealtimeRefresh.js');
  assert.match(hook, /if \(reason === 'realtime' && table && !String\(table\)\.startsWith\('__'\)\) pendingReason = 'realtime'/);
});
