import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LEGAL_DOCUMENTS, LEGAL_LAST_UPDATED } from '../src/content/legalDocuments.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Dashboard meal and late-request figures retain original values and show জন', async () => {
  const source = await read('../src/features/dashboard/DashboardPage.jsx');
  assert.match(source, /formatMeal\(value\)\}<small className="meal-unit-label"> জন<\/small>/);
  assert.match(source, /signedMealDelta\(value\)\}<small className="meal-unit-label"> জন<\/small>/);
  assert.doesNotMatch(source, /(?:breakfast|lunch|dinner)[^\n]{0,80}(?:\*\s*2|\/\s*2)/i);
});

test('Authentication copy and toolbar chip sizing are responsive', async () => {
  const jsx = await read('../src/features/auth/AuthPage.jsx');
  const css = await read('../src/styles/run63_focused_fixes.css');
  assert.match(jsx, /ইমেইল <small className="register-email-label-note">\(সঠিক ইমেইল ব্যবহার করুন\)<\/small>/);
  assert.doesNotMatch(jsx, /অ্যাকাউন্ট যাচাই ও পাসওয়ার্ড পুনরুদ্ধারের জন্য সচল ইমেইল ব্যবহার করুন/);
  assert.match(css, /\.auth-page \.auth-form-toolbar-label[\s\S]*?min-height: 38px/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.auth-page \.auth-form-toolbar-label/);
  assert.match(css, /\.auth-page \.auth-form-panel \.auth-header h2[\s\S]*?font-size: clamp\(27px/);
});

test('Onboarding create form avoids duplicate visible label and automatic invite creation', async () => {
  const source = await read('../src/features/onboarding/OnboardingPage.jsx');
  assert.match(source, /placeholder="যেমন: নিজামুদ্দিন ছাত্রাবাস"/);
  assert.match(source, /className="run63-visually-hidden"/);
  assert.doesNotMatch(source, /managerCreateHostelInviteLink|createdInviteUrl|inviteLinkBusy|onboarding-share-card/);
  assert.match(source, /প্রথম মাস চালু করুন/);
  assert.match(source, /মেসে প্রবেশ করুন/);
  assert.match(source, /অন্য অ্যাকাউন্ট ব্যবহার করুন/);
  assert.doesNotMatch(source, /<span className="eyebrow">মেস তৈরি সম্পন্ন<\/span>/);
});

test('In-app privacy and terms pages use the canonical shared legal source', async () => {
  const source = await read('../src/features/menu/MenuPages.jsx');
  assert.match(source, /import \{ LEGAL_DOCUMENTS, LEGAL_LAST_UPDATED \}/);
  assert.match(source, /const document = LEGAL_DOCUMENTS\.privacy/);
  assert.match(source, /const document = LEGAL_DOCUMENTS\.terms/);
});

test('Public privacy and terms pages are generated from the same canonical source', async () => {
  const generator = await read('../scripts/generate-public-legal-pages.mjs');
  const privacy = await read('../public/privacy-policy.html');
  const terms = await read('../public/terms-of-service.html');
  assert.match(generator, /LEGAL_DOCUMENTS, LEGAL_LAST_UPDATED/);
  assert.match(privacy, /<h1[^>]*>গোপনীয়তা নীতি<\/h1>/);
  assert.match(terms, /<h1[^>]*>ব্যবহারের শর্তাবলী<\/h1>/);
  assert.equal((privacy.match(/<h1[^>]*>/g) || []).length, 1);
  assert.equal((terms.match(/<h1[^>]*>/g) || []).length, 1);
  assert.ok(privacy.includes(LEGAL_LAST_UPDATED));
  assert.ok(terms.includes(LEGAL_LAST_UPDATED));
  for (const section of LEGAL_DOCUMENTS.privacy.sections) {
    for (const paragraph of section.paragraphs) assert.ok(privacy.includes(escapeHtml(paragraph)));
  }
  for (const section of LEGAL_DOCUMENTS.terms.sections) {
    for (const paragraph of section.paragraphs) assert.ok(terms.includes(escapeHtml(paragraph)));
  }
});

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

test('Public privacy policy explains user-facing data and the implemented retention periods without internals', () => {
  const privacy = LEGAL_DOCUMENTS.privacy.sections.flatMap((section) => section.paragraphs).join(' ');
  assert.match(privacy, /IP address/);
  assert.match(privacy, /GPS/);
  assert.match(privacy, /৩০ দিনের/);
  assert.match(privacy, /৪৮ ঘণ্টা/);
  assert.match(privacy, /৩৫ দিন/);
  assert.match(privacy, /Google Sign-In সংযুক্ত করা হয়েছে এবং এটি ঐচ্ছিক/);
  assert.match(privacy, /Google Sign-In সংযুক্ত করা হয়েছে এবং এটি ঐচ্ছিক/);
  assert.doesNotMatch(privacy, /HMAC|fingerprint|identity_fingerprint|service_role|schema|trigger/i);
  assert.doesNotMatch(privacy, /আনুমানিক দেশ বা অঞ্চল/);
  assert.doesNotMatch(privacy, /Authenticator secret/);
});

test('Notice dialogs are bounded and internally scrollable on small screens', async () => {
  const css = await read('../src/styles/run63_focused_fixes.css');
  const component = await read('../src/components/SystemNoticeDialog.jsx');
  assert.match(component, /system-notice-dialog/);
  assert.match(css, /\.system-notice-dialog[\s\S]*?max-height: calc\(100dvh/);
  assert.match(css, /\.system-notice-dialog[\s\S]*?overflow-y: auto/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.system-notice-dialog/);
});

test('Build regenerates both public legal pages before Vite production build', async () => {
  const pkg = JSON.parse(await read('../package.json'));
  assert.match(pkg.scripts.build, /^node scripts\/generate-public-legal-pages\.mjs && vite build$/);
});
