import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Registration email guidance stays beside the label with no extra line below the field', async () => {
  const auth = await read('src/features/auth/AuthPage.jsx');
  const css = await read('src/styles/run65-entry-windows.css');
  assert.match(auth, /ইমেইল <small className="register-email-label-note">\(সঠিক ইমেইল ব্যবহার করুন\)<\/small>/);
  assert.doesNotMatch(auth, /className="register-email-note"|সচল ইমেইল ব্যবহার করুন/);
  assert.match(css, /\.register-email-label-note/);
});

test('Onboarding invitation details are not repeated while preserving pending request controls', async () => {
  const onboarding = await read('src/features/onboarding/OnboardingPage.jsx');
  assert.doesNotMatch(onboarding, /InfoPanel/);
  assert.doesNotMatch(onboarding, /onboarding-linked-request-waiting/);
  assert.match(onboarding, /joinRequestStatus\?\.status === 'pending'[\s\S]*?অনুরোধ অপেক্ষমাণ/);
  assert.match(onboarding, /refreshLinkedRequestStatus/);
  assert.match(onboarding, /joinRequestStatus\?\.status !== 'pending' && <>/);
});

test('Join and create choices use concise labels while keeping business RPCs and safeguards intact', async () => {
  const onboarding = await read('src/features/onboarding/OnboardingPage.jsx');
  assert.match(onboarding, /কোড দিয়ে মেসে যুক্ত হন/);
  assert.match(onboarding, /<span>যোগদানের কোড<\/span>/);
  assert.match(onboarding, /placeholder="A1B2C3D4E5F6"/);
  assert.match(onboarding, /<h3 id="onboarding-action-title">\{mode === 'join' \? 'কোড দিয়ে মেসে যুক্ত হন' : 'নতুন মেস তৈরি'\}<\/h3>/);
  assert.match(onboarding, /placeholder="যেমন: নিজামুদ্দিন ছাত্রাবাস"/);
  assert.match(onboarding, /supabase\.rpc\('join_hostel'/);
  assert.match(onboarding, /supabase\.rpc\('create_hostel_secure'/);
  assert.match(onboarding, /ensureInitialRunningMonth\(\)/);
  assert.match(onboarding, /hostelCodeRequired &&/);
});

test('Desktop entry windows receive structured layouts, with narrow-screen overrides retained', async () => {
  const css = await read('src/styles/run65-entry-windows.css');
  assert.match(css, /@media \(min-width: 900px\)/);
  assert.match(css, /\.auth-shell\.auth-shell-compact/);
  assert.match(css, /\.onboarding-main-card/);
  assert.match(css, /\.onboarding-entry-form-create\.has-permission-code/);
  assert.match(css, /\.hostel-invite-card/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /@media \(max-width: 420px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test('The new visual layer loads after the Run49 and Run63 layers without replacing them', async () => {
  const main = await read('src/main.jsx');
  assert.match(main, /import '\.\/styles\/run49-ui-refinement\.css';/);
  assert.match(main, /import '\.\/styles\/run63_focused_fixes\.css';/);
  assert.match(main, /import '\.\/styles\/run65-entry-windows\.css';/);
  assert.ok(main.indexOf("run65-entry-windows.css") > main.indexOf("run63_focused_fixes.css"));
});

test('Run49 meal-mode behavior remains connected and its SQL migration is retained as history only', async () => {
  const helper = await read('src/utils/mealCountModes.js');
  const dashboard = await read('src/features/dashboard/DashboardPage.jsx');
  const manager = await read('src/features/manager/ManagerPages.jsx');
  const service = await read('src/services/managerService.js');
  const migration = await read('supabase/migrations/Run49_hostel_meal_count_modes.sql');
  const verification = await read('supabase/verify/Verify_Run49_hostel_meal_count_modes.sql');
  assert.match(helper, /DEFAULT_MEAL_COUNT_MODES/);
  assert.match(dashboard, /getMealPeopleCount\(meal\.breakfast, mealCountModes\.breakfast\)/);
  assert.match(manager, /updateMealCountModes\(mealCountModes\)/);
  assert.match(service, /manager_update_meal_count_modes/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS meal_count_modes jsonb NOT NULL/);
  assert.match(verification, /meal_count_modes/);
});
