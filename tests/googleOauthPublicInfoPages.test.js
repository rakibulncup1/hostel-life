import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('public about, privacy and terms pages exist and are Bengali public documents', () => {
  for (const file of ['public/about.html', 'public/privacy-policy.html', 'public/terms-of-service.html']) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} should exist`);
    const html = read(file);
    assert.match(html, /<html lang="bn-BD">/);
    assert.match(html, /<meta name="viewport"/);
    assert.match(html, /Hostel Life/);
    assert.match(html, /href="\/about"/);
  }
});

test('public homepage links to the exact policy pages and explains product functionality', () => {
  const html = read('public/about.html');
  assert.match(html, /href="\/privacy-policy"/);
  assert.match(html, /href="\/terms-of-service"/);
  assert.match(html, /মিলের অনুরোধ/);
  assert.match(html, /বাজার/);
  assert.match(html, /মাসিক হিসাব/);
  assert.match(html, /পেমেন্ট গেটওয়ে/);
  assert.match(html, /href="\/auth\/login"/);
  assert.match(html, /href="\/auth\/register"/);
});

test('privacy page explains actual user-facing data flows without exposing implementation details', () => {
  const html = read('public/privacy-policy.html');
  for (const phrase of ['নাম', 'ইমেইল', 'মোবাইল নম্বর', 'মিল', 'বাজার', 'জমা', 'খরচ', 'Telegram', 'Google Sign-In', 'প্রোফাইল ছবি', 'তথ্য সংরক্ষণ', 'support.sec1.info@gmail.com']) {
    assert.ok(html.includes(phrase), `privacy page should disclose ${phrase}`);
  }
  assert.match(html, /Google Sign-In বর্তমানে অ্যাপে সক্রিয় নয়/);
  assert.match(html, /Google থেকে পাওয়া মৌলিক পরিচয়-তথ্য/);
  assert.doesNotMatch(html, /Supabase|Vercel|IndexedDB|User-Agent|ap-southeast-1|public bucket|openid|userinfo\.email|userinfo\.profile|অভিভাবক|জন্ম নিবন্ধন|জাতীয় পরিচয়পত্র|প্রকাশের আগে পূরণ করতে হবে/);
});

test('terms allow public app URL sharing while protecting private Join Codes and invitations', () => {
  const html = read('public/terms-of-service.html');
  assert.match(html, /ওয়েবসাইটের সাধারণ ঠিকানা বা Hostel Life-এর পরিচিতি পেজ প্রকাশ্যে শেয়ার করা যায়/);
  assert.match(html, /ব্যক্তিগত Join Code, Invitation Link/);
  const appTerms = read('src/features/menu/MenuPages.jsx');
  assert.match(appTerms, /ব্যক্তিগত আমন্ত্রণ ও Join Code সুরক্ষিত রাখুন/);
  assert.doesNotMatch(appTerms, /ওয়েবসাইটের লিংক প্রকাশ্যে শেয়ার নিষিদ্ধ/);
});

test('Vercel serves the public About document at the root before SPA rewrites', () => {
  const config = JSON.parse(read('vercel.json'));
  const rewrites = config.rewrites;
  const catchAll = rewrites.findIndex((rule) => rule.source === '/(.*)');
  assert.notEqual(catchAll, -1);
  assert.ok((config.redirects || []).some((rule) => rule.source === '/' && rule.destination === '/about' && rule.permanent === true));
  assert.ok(rewrites.some((rule) => rule.source === '/about' && rule.destination === '/about.html' && rewrites.indexOf(rule) < catchAll));
  for (const route of ['/about', '/privacy-policy', '/terms-of-service']) {
    const index = rewrites.findIndex((rule) => rule.source === route);
    assert.notEqual(index, -1, `${route} rewrite should exist`);
    assert.ok(index < catchAll, `${route} rewrite must precede the SPA catch-all`);
  }
});

test('service worker does not cache public legal documents as the app shell', () => {
  const sw = read('public/service-worker.js');
  assert.match(sw, /hostel-life-shell-v19/);
  assert.match(sw, /'\/', '\/about', '\/about\.html'/);
  assert.match(sw, /'\/privacy-policy', '\/privacy-policy\.html'/);
  assert.match(sw, /'\/terms-of-service', '\/terms-of-service\.html'/);
  assert.match(sw, /event\.respondWith\(fetch\(request, \{ cache: 'no-store' \}\)\)/);
});

test('login and registration pages expose public legal links before sign-in', () => {
  const auth = read('src/features/auth/AuthPage.jsx');
  assert.match(auth, /aria-label="আইনি তথ্য ও পরিচিতি"/);
  assert.match(auth, /href="\/privacy-policy"/);
  assert.match(auth, /href="\/terms-of-service"/);
  assert.match(auth, /href="\/about"/);
});

test('stage-one guide accurately documents public identity preparation without activating OAuth', () => {
  const guide = read('README_GOOGLE_OAUTH_STAGE1_BN.md');
  assert.match(guide, /OAuth button\/code বা কোনো credential এখনো যোগ হয়নি/);
  assert.match(guide, /Google Client Secret শুধু Supabase Dashboard-এর Google Provider-এ রাখুন/);
  assert.match(guide, /shared subdomain/);
  assert.match(guide, /Privacy Policy ও Terms/);
  assert.match(guide, /guardian-consent/);
});
