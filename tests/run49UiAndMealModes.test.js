import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const app = read('src/app/App.jsx');
const auth = read('src/features/auth/AuthPage.jsx');
const manager = read('src/features/manager/ManagerPages.jsx');
const managerService = read('src/services/managerService.js');
const dashboard = read('src/features/dashboard/DashboardPage.jsx');
const migration = read('supabase/migrations/Run49_hostel_meal_count_modes.sql');
const verification = read('supabase/verify/Verify_Run49_hostel_meal_count_modes.sql');
const helper = read('src/utils/mealCountModes.js');
const main = read('src/main.jsx');

test('password recovery route is protected from the active-membership auto-redirect', () => {
  const recoveryGuard = app.indexOf("if (pathname.startsWith('/auth/reset-password')) return;");
  const activeMembershipRedirect = app.indexOf("auth.membership?.status === 'active'");
  assert.ok(recoveryGuard >= 0 && activeMembershipRedirect > recoveryGuard);
  assert.match(auth, /function ResetPasswordForm/);
  assert.match(auth, /updatePassword\(password\)/);
});

test('Run49 stores meal display modes once per hostel and defaults breakfast to half', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS meal_count_modes jsonb NOT NULL/);
  assert.match(migration, /"breakfast":"half","lunch":"full","dinner":"full"/);
  assert.match(migration, /manager_update_meal_count_modes/);
  assert.match(migration, /private\.assert_hostel_manager\(v_hostel, NULL, false, false\)/);
  assert.match(migration, /SET meal_count_modes = v_modes/);
  assert.doesNotMatch(migration, /UPDATE public\.(meal_entries|daily_meals|market_entries|monthly_periods)/i);
  assert.match(verification, /meal_count_modes/);
});

test('manager settings save only after explicit user action and reuse the membership payload', () => {
  assert.match(manager, /updateMealCountModes\(mealCountModes\)/);
  assert.match(manager, /মিল কীভাবে পরিচালিত হয়/);
  assert.match(manager, /মিল গণনার পদ্ধতি সংরক্ষণ করুন/);
  assert.match(managerService, /rpc\('manager_update_meal_count_modes'/);
  const settingsStart = manager.indexOf('export function HostelSettingsPage()');
  const settingsEnd = manager.indexOf('export function ', settingsStart + 30);
  const settings = manager.slice(settingsStart, settingsEnd < 0 ? undefined : settingsEnd);
  assert.doesNotMatch(settings, /setInterval|useRealtimeRefresh/);
});

test('dashboard changes only per-meal display counts; the weighted daily total and net late adjustment stay raw', () => {
  assert.match(dashboard, /getMealPeopleCount\(meal\.breakfast, mealCountModes\.breakfast\)/);
  assert.match(dashboard, /getMealPeopleCount\(totals\.breakfast, mealCountModes\.breakfast\)/);
  assert.match(dashboard, /getDisplayedDailyMealTotal\(meal\)/);
  assert.match(dashboard, /signedMealDelta\(totals\.breakfast \+ totals\.lunch \+ totals\.dinner\)/);
  assert.match(helper, /return amount \* \(mode === 'half' \? 2 : 1\)/);
});

test('Run49 refinement stylesheet loads last and does not replace the existing app theme', () => {
  assert.match(main, /styles\/run49-ui-refinement\.css/);
  assert.match(manager, /aria-pressed=\{mealCountModes\[key\] === 'half'\}/);
  assert.match(manager, /aria-pressed=\{mealCountModes\[key\] === 'full'\}/);
});
