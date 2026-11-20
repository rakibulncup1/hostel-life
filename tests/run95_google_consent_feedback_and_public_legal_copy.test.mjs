import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGAL_DOCUMENTS } from '../src/content/legalDocuments.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const legalText = (document) => document.sections.flatMap((section) => section.paragraphs).join(' ');

test('Google consent feedback is localized and uses the normal error toast', () => {
  const auth = read('src/features/auth/AuthPage.jsx');
  assert.match(auth, /function getGoogleConsentRequiredMessage\(\)/);
  assert.match(auth, /getUiLocale\(\) === 'en-US'/);
  assert.match(auth, /To continue with Google, confirm that you are at least 18/);
  assert.match(auth, /Google-এর মাধ্যমে চালিয়ে যেতে আপনার বয়স কমপক্ষে ১৮ বছর/);
  assert.equal((auth.match(/toast\.error\(getGoogleConsentRequiredMessage\(\)\)/g) || []).length, 2);
  assert.match(auth, /focusGoogleConsent\(\);\s*toast\.error\(getGoogleConsentRequiredMessage\(\)\)/);
  assert.match(auth, /focusRegisterConsent\(\);\s*toast\.error\(getGoogleConsentRequiredMessage\(\)\)/);
});

test('Clicking the Google placeholder without consent invokes the parent consent feedback only', () => {
  const auth = read('src/features/auth/AuthPage.jsx');
  assert.match(auth, /if \(awaitingConsent\) callbacksRef\.current\.onNeedConsent\?\.\(\)/);
  assert.match(auth, /consentAccepted=\{googleEligibilityAccepted\}/);
  assert.match(auth, /consentAccepted=\{eligibilityAccepted\}/);
  assert.match(auth, /googleId\.renderButton\(/);
});

test('Privacy policy stays user-facing while preserving material privacy and retention disclosures', () => {
  const privacy = legalText(LEGAL_DOCUMENTS.privacy);
  for (const phrase of ['নাম', 'ইমেইল', 'মোবাইল নম্বর', 'প্রোফাইল ছবি', 'IP address', 'GPS', 'Google Sign-In সংযুক্ত করা হয়েছে এবং এটি ঐচ্ছিক', 'Google আপনার পরিচয় যাচাই করে', 'SMS OTP', 'Gmail, Drive, Calendar, Contacts', '৩০ দিন', '৪৮ ঘণ্টা', '৩৫ দিন', 'আপনার তথ্য বিক্রি বা ভাড়া দেওয়া হয় না']) {
    assert.ok(privacy.includes(phrase), `Privacy policy should retain ${phrase}`);
  }
  assert.doesNotMatch(privacy, /platform setting|server-verified|Security Event|daily cleanup|HMAC|fingerprint|service_role|database|backend|schema|trigger|Supabase|Vercel/i);
});

test('Terms explain the user obligations without developer-only implementation details', () => {
  const terms = legalText(LEGAL_DOCUMENTS.terms);
  for (const phrase of ['বয়স কমপক্ষে ১৮ বছর', 'Google দিয়ে নতুন account তৈরি করতে Hostel Life-এর Registration Access Code প্রয়োজন হয় না', 'ইমেইল ও পাসওয়ার্ড দিয়ে account তৈরি করলে Registration Access Code চালু থাকা অবস্থায় বৈধ কোড দিতে হবে', 'Join Code বা Invitation Link', 'ভূমিকা ও অনুমতি', 'নিজের Google account ব্যবহার করুন']) {
    assert.ok(terms.includes(phrase), `Terms should explain ${phrase}`);
  }
  assert.doesNotMatch(terms, /platform setting|server-verified|Security Event|daily cleanup|HMAC|fingerprint|service_role|database|backend|schema|trigger|Supabase|Vercel/i);
});

test('English translations exist for every revised legal paragraph', () => {
  const translations = read('public/app-english-translations.js');
  const revised = [
    LEGAL_DOCUMENTS.privacy.sections[0].paragraphs[1],
    LEGAL_DOCUMENTS.privacy.sections[3].paragraphs[0],
    LEGAL_DOCUMENTS.privacy.sections[3].paragraphs[2],
    LEGAL_DOCUMENTS.privacy.sections[5].paragraphs[0],
    LEGAL_DOCUMENTS.terms.sections[2].paragraphs[1],
    LEGAL_DOCUMENTS.terms.sections[3].paragraphs[0],
    LEGAL_DOCUMENTS.terms.sections[6].paragraphs[1],
  ];
  for (const paragraph of revised) assert.ok(translations.includes(`"${paragraph}"`), `Missing English translation key: ${paragraph.slice(0, 50)}`);
});

test('Generated public legal pages are synchronized with the canonical source', () => {
  const privacyPage = read('public/privacy-policy.html');
  const termsPage = read('public/terms-of-service.html');
  const escapeHtml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  for (const section of LEGAL_DOCUMENTS.privacy.sections) {
    for (const paragraph of section.paragraphs) assert.ok(privacyPage.includes(escapeHtml(paragraph)));
  }
  for (const section of LEGAL_DOCUMENTS.terms.sections) {
    for (const paragraph of section.paragraphs) assert.ok(termsPage.includes(escapeHtml(paragraph)));
  }
  assert.doesNotMatch(privacyPage + termsPage, /platform setting|server-verified|Security Event|daily cleanup|service_role|HMAC|database|backend/i);
});
