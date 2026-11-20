import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const authPage = read('src/features/auth/AuthPage.jsx');
const service = read('src/services/googleOAuthService.js');
const css = read('src/styles/google-oauth-auth-ui.css');
const migration = read('supabase/migrations/Run93_google_registration_access_code_exemption.sql');

test('Google uses a larger official button with one consistent Continue label', () => {
  assert.match(authPage, /size:\s*'large'/);
  assert.match(authPage, /text:\s*'continue_with'/);
  assert.match(authPage, /Math\.min\(400,/);
  assert.match(css, /\.auth-page \.google-signin-button\s*\{[\s\S]*?width:\s*280px/);
  assert.match(css, /\.auth-page \.google-signin-section\s*\{[\s\S]*?width:\s*min\(100%, 320px\)/);
});

test('Google placeholder remains actionable when explicit consent is still missing', () => {
  assert.match(authPage, /const awaitingConsent = !disabled && !consentAccepted/);
  assert.match(authPage, /onClick=\{\(\) => \{[\s\S]*?if \(awaitingConsent\) callbacksRef\.current\.onNeedConsent/);
  assert.match(authPage, /googleConsentRef\.current\?\.querySelector\('input'\)\?\.focus/);
  assert.match(authPage, /registerConsentRef\.current\?\.querySelector\('input'\)\?\.focus/);
});

test('Google SDK failure offers a retry instead of leaving a dead disabled button', () => {
  assert.match(authPage, /const retryAvailable = !disabled && consentAccepted && uiState === 'error'/);
  assert.match(authPage, /else if \(retryAvailable\) setRetryCount/);
  assert.match(authPage, /renderButtonRef\.current\?\./);
});

test('Google rendered button has a bounded container and responds to theme and language changes', () => {
  assert.match(authPage, /hostel-life-language-changed/);
  assert.match(authPage, /hostel-life-theme-change/);
  assert.match(authPage, /if \(uiState === 'ready'\) renderButtonRef\.current\?\./);
  assert.match(css, /\.google-signin-sdk-slot iframe/);
  assert.match(css, /:root\[data-theme="dark"\] \.auth-page \.google-signin-button/);
});

test('Google provider alone skips the platform Registration Access Code; email/password remains gated', () => {
  assert.match(authPage, /registrationCodeRequired && <label className="field-label"><span>অনুমতি কোড<\/span>/);
  assert.match(authPage, /mode="register"[\s\S]*?disabled=\{!online\}/);
  assert.doesNotMatch(authPage, /registrationCodeRequired=|blockedLabel=|showBlockedNotice/);
  assert.doesNotMatch(service, /registrationCodeRequired/);
  assert.match(migration, /v_is_google_provider := COALESCE\(NEW\.raw_app_meta_data ->> 'provider', ''\) = 'google'/);
  assert.match(migration, /IF COALESCE\(v_settings\.registration_code_required, false\)[\s\S]*?AND NOT v_is_google_provider[\s\S]*?NOT private\.consume_access_code\('registration', v_code\)/);
  assert.doesNotMatch(migration, /raw_user_meta_data ->> 'provider'/);
});
test('Google registration presents the same working sign-in control regardless of the platform access-code toggle', () => {
  assert.doesNotMatch(authPage, /showBlockedNotice|blockedLabel|google-signin-blocked-note/);
  assert.match(authPage, /<GoogleSignInButton[\s\S]*?mode="register"[\s\S]*?disabled=\{!online\}/);
  assert.match(authPage, /GoogleSignInDivider/);
});
test('Google registration consent is independent from the platform access-code guard', () => {
  assert.match(authPage, /consentAccepted=\{eligibilityAccepted\}/);
  assert.match(authPage, /consentAccepted=\{googleEligibilityAccepted\}/);
  assert.match(authPage, /auth-combined-consent/);
  assert.match(authPage, /google-signin-consent/);
  assert.match(service, /if \(!eligibilityAccepted\)/);
});

test('Google-specific data notes are removed from the auth screen; disclosure remains in the legal policy', () => {
  assert.doesNotMatch(authPage, /GoogleDataNotice|google-signin-data-note/);
  assert.doesNotMatch(css, /google-signin-data-note/);
});
test('Google-specific UI remains scoped to public auth pages and does not touch application pages', () => {
  const run92 = css.slice(css.indexOf('/* Run92:'));
  assert.match(run92, /\.auth-page \.google-signin-section/);
  assert.match(run92, /\.auth-page \.google-signin-button/);
  assert.doesNotMatch(run92, /\.dashboard-page|\.profile-page|\.about-page|\.dining-page/);
});
