import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const service = read('src/services/googleOAuthService.js');
const callback = read('src/features/auth/GoogleOAuthCallbackPage.jsx');
const app = read('src/app/App.jsx');
const authPage = read('src/features/auth/AuthPage.jsx');
const migration = read('supabase/migrations/Run91_google_profile_phone_completion_gate.sql');
const registrationPolicyMigration = read('supabase/migrations/Run93_google_registration_access_code_exemption.sql');
const legal = read('src/content/legalDocuments.js');
const css = read('src/styles/google-oauth-auth-ui.css');
const envExample = read('.env.example');

 test('Google OAuth remains opt-in and does not expose a client secret', () => {
  assert.match(service, /VITE_GOOGLE_OAUTH_ENABLED === 'true'/);
  assert.match(envExample, /VITE_GOOGLE_OAUTH_ENABLED=false/);
  assert.match(envExample, /VITE_GOOGLE_CLIENT_ID=/);
  assert.doesNotMatch(envExample, /GOOGLE_CLIENT_SECRET|GOOGLE_OAUTH_CLIENT_SECRET/i);
  assert.doesNotMatch(service, /client_secret|refresh_token/i);
});

test('Run93 keeps the Registration Access Code requirement for email signups and exempts only Supabase-authenticated Google signups', () => {
  assert.match(authPage, /registrationCodeRequired && <label className=\"field-label\"><span>অনুমতি কোড<\/span>/);
  assert.match(migration, /registration_code_required/);
  assert.match(registrationPolicyMigration, /NEW\.raw_app_meta_data ->> 'provider'/);
  assert.match(registrationPolicyMigration, /AND NOT v_is_google_provider/);
  assert.match(registrationPolicyMigration, /NOT private\.consume_access_code\('registration', v_code\)/);
  assert.doesNotMatch(registrationPolicyMigration, /raw_user_meta_data ->> 'provider'/);
  assert.doesNotMatch(service, /registrationCodeRequired/);
});

test('Google registration defers mobile entry and no longer waits for the Registration Access Code setting', () => {
  assert.match(authPage, /mode=\"register\"[\s\S]*?disabled=\{!online\}/);
  assert.match(authPage, /consentAccepted=\{eligibilityAccepted\}/);
  assert.doesNotMatch(authPage, /registrationCodeRequired \|\| name\.trim\(\)\.length < 2 \|\| phone\.replace/);
  assert.doesNotMatch(service, /registrationCodeRequired/);
  assert.doesNotMatch(service, /if \(String\(fullName\)\.trim\(\)\.length < 2\)/);
});

test('Google phone validation accepts only 8 to 15 digits after normalization', () => {
  assert.match(service, /export function isValidGooglePhone/);
  assert.match(service, /digits\.length >= 8 && digits\.length <= 15/);
  assert.match(service, /\[০-৯\]/);
  assert.match(service, /normalizeGooglePhone/);
  assert.match(migration, /length\(regexp_replace\(COALESCE\(p\.phone, ''\), '\[\^0-9\]', '', 'g'\)\) BETWEEN 8 AND 15/);
  assert.match(migration, /length\(v_phone_digits\) NOT BETWEEN 8 AND 15/);
});

test('Google photo import is restricted to HTTPS Google user-content hosts', () => {
  assert.match(service, /export function sanitizeGoogleAvatarUrl/);
  assert.match(service, /url\.protocol !== 'https:'/);
  assert.match(service, /googleusercontent/);
  assert.match(migration, /googleusercontent/);
  assert.match(callback, /providerAvatarFrom/);
  assert.match(callback, /existingAvatar \|\| safeProviderAvatar/);
});

test('Google identity sees only its own profile before mobile completion', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION private\.assert_identity_session\(\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_my_profile\(\)[\s\S]*?PERFORM private\.assert_identity_session\(\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_my_membership\(\)[\s\S]*?IF NOT private\.has_required_google_mobile\(\) THEN[\s\S]*?RETURN NULL/);
});

test('Normal app RPCs and hostel RLS are blocked until Google mobile completion', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION private\.assert_signed_in\(\)[\s\S]*?IF NOT private\.has_required_google_mobile\(\) THEN/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION private\.can_access_hostel\(p_hostel_id uuid\)[\s\S]*?private\.has_required_google_mobile\(\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION private\.can_manage_hostel\([\s\S]*?private\.has_required_google_mobile\(\)/);
  assert.match(app, /Google-linked accounts must complete their mobile profile before any/);
  assert.match(app, /navigateTo\('\/auth\/google-callback', true\)/);
});

test('Profile-completion RPC is the narrow bootstrap exception and requires a valid Google phone', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.update_my_profile\([\s\S]*?PERFORM private\.assert_identity_session\(\)/);
  assert.match(migration, /IF private\.is_google_oauth_identity\(\) THEN[\s\S]*?length\(v_phone_digits\) NOT BETWEEN 8 AND 15/);
  assert.match(callback, /supabase\.rpc\('update_my_profile'/);
  assert.match(callback, /Google আপনার মোবাইল নম্বর দেয় না/);
  assert.match(callback, /SMS OTP যাচাই করা হবে না/);
});

test('Phone completion preserves the existing Google name, email, and user-selected avatar', () => {
  assert.match(callback, /providerNameFrom/);
  assert.match(callback, /auth\.user\?\.email/);
  assert.match(callback, /providerAvatarFrom/);
  assert.match(callback, /displayEmail = auth\.user\?\.email/);
  assert.match(callback, /const nextAvatar = existingAvatar \|\| safeProviderAvatar/);
});

test('Age and current legal acceptance remain mandatory for Google sign-in and fallback completion', () => {
  assert.match(service, /if \(!eligibilityAccepted\)/);
  assert.match(authPage, /auth-legal-consent google-signin-consent/);
  assert.match(callback, /legalConsentRequired && !legalAccepted/);
  assert.match(callback, /makeLegalConsentMetadata/);
  assert.match(callback, /age_18_plus_confirmed: true/);
  assert.match(callback, /terms_accepted_at: acceptedAt/);
  assert.match(callback, /privacy_policy_accepted_at: acceptedAt/);
});

test('Google sign-in uses no additional Google service or phone scopes', () => {
  assert.match(authPage, /googleId\.initialize\(/);
  assert.match(authPage, /googleId\.renderButton\(/);
  assert.match(service, /supabase\.auth\.signInWithIdToken\(/);
  assert.doesNotMatch(service, /gmail|drive|calendar|contacts/i);
});

test('Google data use and manual mobile collection are disclosed in legal documents', () => {
  assert.match(legal, /নতুন Google account তৈরি করলে অ্যাপের অন্যান্য অংশ ব্যবহারের আগে একটি মোবাইল নম্বর দিতে হবে/);
  assert.match(legal, /এই ধাপে নম্বরটি SMS OTP দিয়ে যাচাই করা হয় না/);
  assert.match(legal, /Registration Access Code/);
  assert.match(legal, /Google দিয়ে নতুন account তৈরি করতে Hostel Life-এর Registration Access Code প্রয়োজন হয় না/);
  assert.match(legal, /মেসে যোগদানের জন্য সংশ্লিষ্ট Join Code বা Invitation Link-এর নিয়ম মেনে চলতে হবে/);
});

test('Google completion UI has a profile summary and responsive avatar styling', () => {
  assert.match(callback, /google-oauth-profile-heading/);
  assert.match(callback, /<img src=\{avatarUrl\}/);
  assert.match(css, /\.google-oauth-profile-heading/);
  assert.match(css, /:root\[data-theme="dark"\] \.google-oauth-profile-avatar/);
});

test('New Google profile remains incomplete until phone is saved and identity is refreshed', () => {
  assert.match(callback, /if \(!isValidGooglePhone\(identity\?\.profile\?\.phone\)\)/);
  assert.match(callback, /await auth\.refreshIdentity\(\)/);
  assert.match(callback, /clearPendingGoogleOAuth\(\)/);
});

 test('Run91 database migration is additive and does not change tables, policies, triggers, or access-code rules', () => {
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
  assert.doesNotMatch(migration, /ALTER TABLE|DROP POLICY|CREATE POLICY|DROP TRIGGER|DROP TABLE|DELETE FROM/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION private\.handle_new_auth_user/);
  assert.match(migration, /private\.consume_access_code\('registration', v_code\)/);
  assert.match(migration, /googleusercontent/);
});

test('Google-specific CSS affects only the OAuth profile-completion screen', () => {
  const tail = css.slice(css.indexOf('.google-oauth-profile-heading {'));
  assert.match(tail, /\.google-oauth-profile-heading/);
  assert.doesNotMatch(tail, /\.dashboard-page|\.profile-page|\.dining-page|\.about-page/);
});
