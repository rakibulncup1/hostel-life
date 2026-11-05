import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('registration uses one required checkbox for 18+ and policy acceptance', () => {
  const auth = read('src/features/auth/AuthPage.jsx');
  assert.match(auth, /eligibilityAccepted/);
  assert.match(auth, /আমার বয়স কমপক্ষে ১৮ বছর/);
  assert.match(auth, /ব্যবহারের শর্তাবলী/);
  assert.match(auth, /গোপনীয়তা নীতি/);
  assert.match(auth, /disabled=\{submitting \|\| !online \|\| !eligibilityAccepted\}/);
  assert.doesNotMatch(auth, /ageEligibility|radio|auth-age-block-message|অভিভাবক/);
  assert.doesNotMatch(auth, /type="date"|জন্মতারিখ|জন্ম নিবন্ধন|জাতীয় পরিচয়পত্র/);
});

test('age and legal acceptance metadata stays in the existing sign-up request', () => {
  const auth = read('src/features/auth/AuthPage.jsx');
  const service = read('src/services/authService.js');
  for (const key of ['age18PlusConfirmed', 'ageConfirmationAt', 'termsAcceptedAt', 'privacyPolicyAcceptedAt', 'legalPolicyVersion']) {
    assert.ok(auth.includes(key), `AuthPage should pass ${key}`);
  }
  for (const key of ['age_18_plus_confirmed', 'age_confirmation_at', 'terms_accepted_at', 'privacy_policy_accepted_at', 'legal_policy_version']) {
    assert.ok(service.includes(key), `authService should persist ${key} in user metadata`);
  }
});

test('public legal pages are concise, have real contact details and no unfinished placeholders or backend identifiers', () => {
  const terms = read('public/terms-of-service.html');
  const privacy = read('public/privacy-policy.html');
  for (const page of [terms, privacy]) {
    assert.match(page, /support\.sec1\.info@gmail\.com/);
    assert.doesNotMatch(page, /প্রকাশের আগে পূরণ করতে হবে|\[বাস্তব|\[সেবার|Supabase|Vercel|ap-southeast-1|Region|database|ডাটাবেজ|অভিভাবক|জন্ম নিবন্ধন|জাতীয় পরিচয়পত্র/);
    assert.match(page, /কমপক্ষে ১৮ বছর/);
  }
  assert.match(privacy, /Google Sign-In বর্তমানে অ্যাপে সক্রিয় নয়/);
  assert.match(privacy, /Google থেকে পাওয়া মৌলিক পরিচয়-তথ্য/);
});

test('About is the default document on Vite dev, preview and Vercel root', () => {
  const config = read('vite.config.js');
  const vercel = JSON.parse(read('vercel.json'));
  assert.match(config, /hostel-life-public-document-aliases/);
  assert.match(config, /configureServer\(server\)/);
  assert.match(config, /configurePreviewServer\(server\)/);
  for (const route of ['/', '/about', '/privacy-policy', '/terms-of-service']) {
    assert.ok(config.includes(`['${route}', '${route === '/' ? '/about' : route}.html']`), `${route} should map to a public HTML document`);
  }
  assert.ok(vercel.redirects.some((row) => row.source === '/' && row.destination === '/about' && row.permanent === true));
  assert.equal(vercel.rewrites.some((row) => row.source === '/' && row.destination === '/about.html'), false);
  assert.match(read('public/about.html'), /মিল, বাজারের খরচ ও সদস্যদের জমা/);
  assert.match(read('public/about.html'), /\/auth\/login/);
  assert.match(read('public/about.html'), /\/auth\/register/);
});

test('Super Admin login return is short-lived and keeps server-side authorization and reauthentication', () => {
  const app = read('src/app/App.jsx');
  const page = read('src/features/platform/SuperAdminPage.jsx');
  const vercel = JSON.parse(read('vercel.json'));
  assert.match(app, /SUPER_ADMIN_RETURN_KEY/);
  assert.match(app, /SUPER_ADMIN_RETURN_TTL_MS/);
  assert.match(app, /navigateTo\('\/super-admin', true\)/);
  assert.match(page, /select\('role,is_blocked'\)/);
  assert.match(page, /data\?\.role === 'super_admin' && data\?\.is_blocked !== true/);
  assert.match(page, /verifyPassword/);
  assert.ok(vercel.headers.some((row) => row.source === '/super-admin' && row.headers.some((h) => h.key === 'X-Robots-Tag')));
});

test('registration consent styling remains responsive and theme-token based', () => {
  const css = read('src/styles/public-entry.css');
  assert.match(css, /\.auth-legal-consent/);
  assert.match(css, /var\(--surface\)/);
  assert.match(css, /var\(--text\)/);
  assert.doesNotMatch(css, /auth-eligibility-fieldset|auth-age-block-message/);
});
