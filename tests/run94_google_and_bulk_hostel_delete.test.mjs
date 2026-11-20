import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const authPage = read('src/features/auth/AuthPage.jsx');
const run94Css = read('src/styles/run94-focused-fixes.css');
const main = read('src/main.jsx');
const onboarding = read('src/features/onboarding/OnboardingPage.jsx');
const superAdmin = read('src/features/platform/SuperAdminPage.jsx');
const platformService = read('src/services/platformService.js');
const migration = read('supabase/migrations/Run94_activity_hostel_delete_guard_and_bulk_delete.sql');
const authDeleteEdge = read('supabase/functions/admin-delete-unlinked-user/index.ts');

test('Google GIS script and button use the same selected language after consent', () => {
  assert.match(authPage, /function loadGoogleIdentityServices\(locale = 'bn'\)/);
  assert.match(authPage, /gsi\/client\?hl=\$\{googleLanguage\}/);
  assert.match(authPage, /loadGoogleIdentityServices\(english \? 'en' : 'bn'\)/);
  assert.match(authPage, /locale: english \? 'en' : 'bn'/);
  assert.match(authPage, /size: 'large'/);
  assert.doesNotMatch(authPage, /size: 'medium'/);
});

test('Google consent remains required before enabling the real sign-in flow', () => {
  assert.match(authPage, /const awaitingConsent = !disabled && !consentAccepted/);
  assert.match(authPage, /const placeholderDisabled = disabled \|\| loading \|\| uiState === 'loading' \|\| \(!awaitingConsent && !retryAvailable\)/);
  assert.match(authPage, /if \(awaitingConsent\) callbacksRef\.current\.onNeedConsent\?\.\(\)/);
  assert.match(authPage, /eligibilityAccepted: true/);
});

test('Google button receives a slightly taller container without increasing its width', () => {
  assert.match(run94Css, /\.auth-page \.google-signin-sdk-slot\s*\{\s*min-height:\s*48px/);
  assert.match(run94Css, /\.auth-page \.google-signin-button\s*\{\s*min-height:\s*48px/);
  assert.match(main, /run94-focused-fixes\.css/);
  assert.match(authPage, /Math\.min\(280/);
});

test('hostel-creation permission code layout is only overridden on desktop', () => {
  assert.match(onboarding, /onboarding-entry-form-create \$\{hostelCodeRequired \? 'has-permission-code'/);
  assert.match(run94Css, /@media \(min-width: 761px\)[\s\S]*?\.onboarding-entry-form-create\.has-permission-code[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(run94Css, /width:\s*min\(500px, 100%\)/);
});

test('activity guard preserves events while clearing only an invalid hostel FK reference', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION private\.hl_activity_events_guard_hostel_reference/);
  assert.match(migration, /is_nullable = 'NO'[\s\S]*?must remain nullable/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OF hostel_id ON private\.hl_activity_events/);
  assert.match(migration, /FOR KEY SHARE/);
  assert.match(migration, /IF NOT FOUND THEN\s+NEW\.hostel_id := NULL/);
  assert.doesNotMatch(migration, /DROP TABLE\s+private\.hl_activity_events/i);
  assert.doesNotMatch(migration, /DROP CONSTRAINT[^;]*hl_activity_events_hostel_id_fkey/i);
});

test('bulk database RPC validates the whole selection and deletes it transactionally', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.platform_admin_permanently_delete_hostels/);
  assert.match(migration, /PERFORM private\.assert_signed_in\(\)/);
  assert.match(migration, /IF NOT private\.is_super_admin\(\)/);
  assert.match(migration, /cardinality\(p_hostel_ids\) < 2/);
  assert.match(migration, /cardinality\(p_hostel_ids\) > 25/);
  assert.match(migration, /count\(DISTINCT selected_id\)/);
  assert.match(migration, /DELETE ' \|\| pg_catalog\.cardinality\(p_hostel_ids\)::text \|\| ' HOSTELS'/);
  assert.match(migration, /ORDER BY h\.id\s+FOR UPDATE/);
  assert.match(migration, /m\.hostel_id = ANY\(v_locked_ids\)/);
  assert.match(migration, /m\.user_id <> auth\.uid\(\)/);
  assert.match(migration, /public\.platform_admin_permanently_delete_hostel\([\s\S]*?false,[\s\S]*?'DELETE HOSTEL '/);
  assert.match(migration, /'candidate_user_ids', pg_catalog\.to_jsonb\(v_candidate_user_ids\)/);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+auth\.users/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.platform_admin_permanently_delete_hostels\(uuid\[\], boolean, text\) TO authenticated/);
});

test('Super Admin UI selects up to 25 hostels across pages and requires typed bulk confirmation', () => {
  assert.match(superAdmin, /bulkHostelSelectedIds/);
  assert.match(superAdmin, /bulkHostelSelectedIds\.length >= 25/);
  assert.match(superAdmin, /kind:'hostels', hostelIds:\[\.\.\.bulkHostelSelectedIds\]/);
  assert.match(superAdmin, /DELETE \$\{bulkHostelIds\.length\} HOSTELS/);
  assert.match(superAdmin, /platform-bulk-delete-hostel-list/);
  assert.match(superAdmin, /permanentlyDeleteHostels\(\)/);
});

test('optional bulk Auth cleanup reuses the guarded Edge Function instead of deleting auth.users in SQL', () => {
  assert.match(platformService, /platformAdminPermanentlyDeleteHostels/);
  assert.match(platformService, /platform_admin_permanently_delete_hostels/);
  assert.match(superAdmin, /action: 'delete_many', user_ids: batch, confirmation: expected/);
  assert.match(authDeleteEdge, /body\.action === 'delete_many'/);
  assert.match(authDeleteEdge, /hostel_memberships/);
  assert.match(authDeleteEdge, /target\?\.role === 'super_admin'/);
  assert.match(authDeleteEdge, /admin\.auth\.admin\.deleteUser\(targetId\)/);
});
