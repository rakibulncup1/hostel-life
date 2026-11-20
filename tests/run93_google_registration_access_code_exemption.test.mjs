import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const authPage = read('src/features/auth/AuthPage.jsx');
const googleService = read('src/services/googleOAuthService.js');
const migration = read('supabase/migrations/Run93_google_registration_access_code_exemption.sql');
const legal = read('src/content/legalDocuments.js');
const translations = read('public/app-english-translations.js');
const privacyPage = read('public/privacy-policy.html');
const termsPage = read('public/terms-of-service.html');
const css = read('src/styles/google-oauth-auth-ui.css');

test('Run93 is additive and replaces only the auth.users profile-creation trigger function', () => {
  assert.match(migration, /BEGIN;[\s\S]*CREATE OR REPLACE FUNCTION private\.handle_new_auth_user\(\)[\s\S]*COMMIT;\s*$/);
  assert.doesNotMatch(migration, /ALTER TABLE|DROP TABLE|DROP POLICY|CREATE POLICY|DROP TRIGGER|CREATE TRIGGER|DELETE FROM/i);
  assert.match(migration, /RETURNS trigger[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = ''/);
});

test('Only Supabase-managed Google provider metadata can activate the Access Code exception', () => {
  assert.match(migration, /NEW\.raw_app_meta_data ->> 'provider', ''\) = 'google'/);
  assert.doesNotMatch(migration, /raw_user_meta_data\s*->>\s*'provider'/);
  assert.match(migration, /v_is_google_provider boolean/);
  assert.match(migration, /AND NOT v_is_google_provider/);
});

test('Email/password signup still consumes the Registration Access Code when the platform toggle is on', () => {
  assert.match(migration, /IF COALESCE\(v_settings\.registration_code_required, false\)[\s\S]*?AND NOT v_is_google_provider[\s\S]*?NOT private\.consume_access_code\('registration', v_code\)/);
  assert.match(authPage, /registrationCodeRequired && <label className="field-label"><span>অনুমতি কোড<\/span>/);
  assert.match(authPage, /permissionCode/);
});

test('Google registration no longer depends on the public Access Code setting or a client-provided bypass flag', () => {
  assert.match(authPage, /<GoogleSignInButton[\s\S]*?mode="register"[\s\S]*?disabled=\{!online\}/);
  assert.doesNotMatch(authPage, /registrationCodeRequired=|blockedLabel=|showBlockedNotice/);
  assert.doesNotMatch(googleService, /registrationCodeRequired|permission_code/);
  assert.match(googleService, /provider:\s*'google'/);
  assert.match(googleService, /signInWithIdToken/);
});

test('Google ID token, nonce and provider exchange remain intact', () => {
  assert.match(googleService, /crypto\.getRandomValues\(new Uint8Array\(32\)\)/);
  assert.match(googleService, /SHA-256/);
  assert.match(googleService, /nonce:\s*pending\.nonce/);
  assert.match(googleService, /signInWithIdToken\(\{/);
  assert.match(googleService, /GOOGLE_OAUTH_POLICY_VERSION = '2026-11-20'/);
});

test('Google registration keeps the 18+ and Terms/Privacy consent gate on both auth pages', () => {
  assert.match(authPage, /googleEligibilityAccepted/);
  assert.match(authPage, /consentAccepted=\{googleEligibilityAccepted\}/);
  assert.match(authPage, /consentAccepted=\{eligibilityAccepted\}/);
  assert.match(authPage, /ব্যবহারের শর্তাবলী/);
  assert.match(authPage, /গোপনীয়তা নীতি/);
  assert.match(googleService, /if \(!eligibilityAccepted\)/);
});

test('Google registration retains the profile-completion mobile requirement and provider callback route', () => {
  assert.match(authPage, /\/auth\/google-callback/);
  const phoneGate = read('supabase/migrations/Run91_google_profile_phone_completion_gate.sql');
  assert.match(phoneGate, /has_required_google_mobile/);
  assert.match(phoneGate, /length\(regexp_replace\(COALESCE\(p\.phone, ''\), '\[\^0-9\]', '', 'g'\)\) BETWEEN 8 AND 15/);
  assert.match(phoneGate, /assert_signed_in\(\)[\s\S]*?has_required_google_mobile/);
});

test('Hostel Join Code and hostel-creation permission-code procedures are not bypassed or redefined', () => {
  assert.doesNotMatch(migration, /join_hostel|p_join_code|hostel_creation|create_hostel_secure/i);
  const onboarding = read('src/features/onboarding/OnboardingPage.jsx');
  assert.match(onboarding, /supabase\.rpc\('join_hostel', \{ p_join_code: code \}\)/);
  assert.match(onboarding, /create_hostel_secure/);
  const original = read('supabase/migrations/Run1.sql');
  assert.match(original, /consume_access_code\('hostel_creation'/);
});

test('Login and Registration Google area is compact: divider, one button, and consent only', () => {
  assert.equal((authPage.match(/<GoogleSignInButton/g) || []).length, 2);
  assert.equal((authPage.match(/<GoogleSignInDivider \/>/g) || []).length, 2);
  assert.doesNotMatch(authPage, /GoogleDataNotice|google-signin-data-note|google-signin-blocked-note/);
  assert.doesNotMatch(css, /google-signin-data-note/);
  assert.match(css, /\.auth-page \.google-signin-section/);
});

test('Canonical in-app and generated public legal pages distinguish Google registration from email registration', () => {
  assert.match(legal, /Google দিয়ে নতুন account তৈরি করতে Hostel Life-এর Registration Access Code প্রয়োজন হয় না/);
  assert.match(legal, /ইমেইল ও পাসওয়ার্ড দিয়ে account তৈরি করলে Registration Access Code চালু থাকা অবস্থায় বৈধ কোড দিতে হবে/);
  assert.match(legal, /মেসে যোগদানের জন্য সংশ্লিষ্ট Join Code বা Invitation Link-এর নিয়ম মেনে চলতে হবে/);
  assert.doesNotMatch(privacyPage, /Registration Access Code/);
  assert.match(termsPage, /Google দিয়ে নতুন account তৈরি করতে Hostel Life-এর Registration Access Code প্রয়োজন হয় না/);
  assert.match(translations, /Creating a new account with Google does not require Hostel Life’s Registration Access Code/);
  assert.match(translations, /When creating an account with email and password, you must enter a valid Registration Access Code/);
});
