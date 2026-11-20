import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const service = read('src/services/googleOAuthService.js');
const authPage = read('src/features/auth/AuthPage.jsx');
const callback = read('src/features/auth/GoogleOAuthCallbackPage.jsx');
const app = read('src/app/App.jsx');
const css = read('src/styles/google-oauth-auth-ui.css');
const legal = read('src/content/legalDocuments.js');
const runtime = read('public/language-runtime.js');
const envExample = read('.env.example');
const main = read('src/main.jsx');

 test('Google Identity Services stays disabled unless the explicit flag and public client ID are configured', () => {
  assert.match(service, /VITE_GOOGLE_OAUTH_ENABLED === 'true'/);
  assert.match(service, /VITE_GOOGLE_CLIENT_ID/);
  assert.match(service, /GOOGLE_OAUTH_FEATURE_FLAG && Boolean\(GOOGLE_OAUTH_CLIENT_ID\)/);
  assert.match(envExample, /VITE_GOOGLE_OAUTH_ENABLED=false/);
  assert.match(envExample, /VITE_GOOGLE_CLIENT_ID=/);
  assert.match(authPage, /GOOGLE_OAUTH_FEATURE_ENABLED &&/);
  assert.doesNotMatch(envExample, /GOOGLE_CLIENT_SECRET|GOOGLE_OAUTH_CLIENT_SECRET/i);
});

test('Google uses the official Identity Services SDK and Google-rendered sign-in button', () => {
  assert.match(authPage, /https:\/\/accounts\.google\.com\/gsi\/client/);
  assert.match(authPage, /if \(script\?\.dataset\.hostelGoogleIdentity === 'true'\) script\.remove\(\)/);
  assert.match(authPage, /googleId\.initialize\(/);
  assert.match(authPage, /use_fedcm_for_prompt:\s*true/);
  assert.match(authPage, /googleId\.renderButton\(/);
  assert.match(authPage, /text:\s*'continue_with'/);
  assert.match(authPage, /theme:\s*darkTheme \? 'filled_black' : 'outline'/);
  assert.match(authPage, /locale:\s*english \? 'en' : 'bn'/);
});

test('Google ID credential is exchanged through Supabase signInWithIdToken, not redirect OAuth', () => {
  assert.match(authPage, /response\.credential/);
  assert.match(service, /supabase\.auth\.signInWithIdToken\(/);
  assert.match(service, /provider:\s*'google'/);
  assert.match(service, /token:\s*credential/);
  assert.doesNotMatch(service, /signInWithOAuth|redirectTo|scopes:\s*['"]openid/i);
});

test('Google nonce is random, hashed for GIS and supplied raw to Supabase', () => {
  assert.match(service, /crypto\.getRandomValues\(new Uint8Array\(32\)\)/);
  assert.match(service, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(authPage, /nonce:\s*prepared\.hashedNonce/);
  assert.match(service, /nonce:\s*pending\.nonce/);
});

test('The local post-auth route is internal and automatic redirects wait for token exchange', () => {
  assert.match(authPage, /go\('\/auth\/google-callback', true\)/);
  assert.match(app, /pathname === '\/auth\/google-callback' \|\| isGoogleOAuthExchanging\(\)/);
  assert.match(app, /pathname === '\/auth\/google-callback'.*GoogleOAuthCallbackPage/s);
  assert.doesNotMatch(service, /redirectTo:\s*['"]\/auth\/google-callback/);
});

test('Login Google button requires explicit 18+ and current policy consent', () => {
  assert.match(authPage, /googleEligibilityAccepted/);
  assert.match(service, /Google sign-in-এর আগে ১৮\+ বয়স ও নীতিমালায় সম্মতি নিশ্চিত করুন/);
  assert.match(authPage, /auth-legal-consent google-signin-consent/);
});

test('Email/password registration keeps its original server-side Registration Access Code gate', () => {
  assert.match(authPage, /registrationCodeRequired && <label className="field-label"><span>অনুমতি কোড<\/span>/);
  const originalMigration = read('supabase/migrations/Run1.sql');
  const googlePolicyMigration = read('supabase/migrations/Run93_google_registration_access_code_exemption.sql');
  assert.match(originalMigration, /registration_code_required/);
  assert.match(originalMigration, /consume_access_code\('registration'/);
  assert.match(googlePolicyMigration, /AND NOT v_is_google_provider/);
  assert.match(googlePolicyMigration, /private\.consume_access_code\('registration', v_code\)/);
  assert.doesNotMatch(service, /registrationCodeRequired/);
});
test('Pending identity-consent context is short-lived, validated and never stores tokens or client secrets', () => {
  assert.match(service, /GOOGLE_OAUTH_PENDING_TTL_MS = 15 \* 60 \* 1000/);
  assert.match(service, /sessionStorage\.setItem/);
  assert.match(service, /acceptedAt/);
  assert.match(service, /legalPolicyVersion/);
  assert.match(service, /status === 'exchanging'/);
  assert.doesNotMatch(service, /client_secret|refresh_token|access_token/i);
});

test('Callback records age and legal acceptance before routing the authenticated account', () => {
  assert.match(callback, /buildGoogleConsentMetadata/);
  assert.match(service, /age_18_plus_confirmed:\s*true/);
  assert.match(service, /terms_accepted_at/);
  assert.match(service, /privacy_policy_accepted_at/);
  assert.match(callback, /signOut\(\{ scope: 'local' \}\)/);
});

test('Google account details are imported and a mobile number is completed before app access', () => {
  assert.match(callback, /Google থেকে পাওয়া নাম, ইমেইল ও প্রোফাইল ছবি প্রস্তুত/);
  assert.match(callback, /update_my_profile/);
  assert.match(callback, /isValidGooglePhone/);
  assert.match(app, /!isValidGooglePhone\(auth\.profile\?\.phone\)/);
});

test('Google button uses the official multicolour G and theme/localized SDK styling', () => {
  assert.match(authPage, /google-signin-mark/);
  assert.match(authPage, /#4285F4/);
  assert.match(css, /google-signin-sdk-slot/);
  assert.match(css, /:root\[data-theme="dark"\] \.auth-page \.google-signin-widget/);
});

test('Google data disclosures live in the canonical legal pages, not beside the sign-in button', () => {
  assert.doesNotMatch(authPage, /GoogleDataNotice|google-signin-data-note/);
  assert.match(legal, /Gmail, Drive, Calendar, Contacts/);
  assert.match(legal, /Google দিয়ে নতুন account তৈরি করতে Hostel Life-এর Registration Access Code প্রয়োজন হয় না/);
  assert.match(legal, /ইমেইল ও পাসওয়ার্ড দিয়ে account তৈরি করলে Registration Access Code চালু থাকা অবস্থায় বৈধ কোড দিতে হবে/);
  assert.match(legal, /মেসে যোগদানের জন্য সংশ্লিষ্ট Join Code বা Invitation Link-এর নিয়ম মেনে চলতে হবে/);
});
test('Published privacy and terms pages disclose optional Google Sign-In and distinct registration-code rules', () => {
  const privacy = read('public/privacy-policy.html');
  const terms = read('public/terms-of-service.html');
  assert.match(privacy, /Google Sign-In সংযুক্ত করা হয়েছে এবং এটি ঐচ্ছিক/);
  assert.doesNotMatch(privacy, /Registration Access Code/);
  assert.match(terms, /Google Sign-In ঐচ্ছিক/);
  assert.match(terms, /ইমেইল ও পাসওয়ার্ড দিয়ে account তৈরি করলে Registration Access Code চালু থাকা অবস্থায় বৈধ কোড দিতে হবে/);
});

test('Only the Google authentication UI stylesheet is added to the main app bundle', () => {
  assert.match(main, /import '\.\/styles\/google-oauth-auth-ui\.css'/);
  assert.match(css, /\.auth-page \.google-signin-section/);
  assert.match(css, /\.google-oauth-callback-page/);
  assert.doesNotMatch(css, /\.dashboard-page|\.profile-page|\.about-page|\.dining-page/);
});

test('No Google client secret is included in frontend source or Vite environment example', () => {
  assert.doesNotMatch(read('src/main.jsx'), /CLIENT_SECRET|client_secret/i);
  assert.doesNotMatch(read('src/features/auth/AuthPage.jsx'), /CLIENT_SECRET|client_secret/i);
  assert.doesNotMatch(envExample, /CLIENT_SECRET|client_secret/i);
  assert.match(service, /VITE_GOOGLE_CLIENT_ID/);
});

test('Google chooser explicitly distinguishes sign-in and sign-up and uses popup UX', () => {
  assert.match(authPage, /context: mode === 'register' \? 'signup' : 'signin'/);
  assert.match(authPage, /ux_mode: 'popup'/);
});

test('Google registration is independent of the platform access-code setting while email signup still reads it', () => {
  assert.match(authPage, /if \(typeof settings\?\.registration_code_required !== 'boolean'\)/);
  assert.match(authPage, /setRegistrationCodeRequired\(true\)/);
  assert.match(authPage, /registrationPolicyStatus === 'loading'/);
  assert.match(authPage, /registrationCodeRequired && <label className="field-label"><span>অনুমতি কোড<\/span>/);
  assert.match(authPage, /<GoogleSignInButton[\s\S]*?mode="register"[\s\S]*?disabled=\{!online\}/);
  assert.doesNotMatch(authPage, /registrationCodeRequired=|registrationPolicyStatus !== 'loaded' \|\| registrationCodeRequired/);
  assert.doesNotMatch(service, /registrationCodeRequired/);
});