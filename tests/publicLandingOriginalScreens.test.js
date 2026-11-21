import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(root, relative));

const about = read('public/about.html');
const privacy = read('public/privacy-policy.html');
const terms = read('public/terms-of-service.html');
const css = read('public/landing-assets/public-experience.css');

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

test('About page renders its feature previews with code instead of app screenshots', () => {
  assert.doesNotMatch(about, /<img[^>]+src=["']\/landing-assets\/[^"']+\.webp/i);
  assert.doesNotMatch(about, /landing-assets\/(?:dashboard|dining|meal-request|market-entry|deposit|allowance|manager-requests|manager-menu|final-report-anonymized)\.webp/);
  assert.match(about, /og\/hostel-life-social\.png/);
  assert.equal((about.match(/class="code-preview /g) || []).length, 2);
  assert.equal((about.match(/class="mini-preview /g) || []).length, 4);
  assert.equal((about.match(/class="showcase-code-preview /g) || []).length, 3);
  assert.match(about, /ইন্টারফেস প্রিভিউ/);
  assert.doesNotMatch(about, /কোডে তৈরি|code-built/i);
  assert.match(about, /ইন্টারফেসের নমুনা/);
});

test('code-native previews are illustrative, accessible and not clickable screenshots', () => {
  assert.match(about, /class="hero-gallery"/);
  assert.match(about, /class="screen-card screen-card--primary"/);
  assert.match(about, /class="screen-card screen-card--secondary"/);
  assert.match(about, /role="img" aria-label="ড্যাশবোর্ডের নমুনা/);
  assert.match(about, /নমুনা তথ্য/);
  assert.match(about, /রিপোর্ট প্রিভিউ|ইন্টারফেস প্রিভিউ/);
  assert.doesNotMatch(about, /কোডে তৈরি|code-built/i);
  assert.doesNotMatch(about, /<a[^>]+href=["'][^"']*landing-assets\//i);
});

test('hero previews are separate responsive layout items rather than overlapping screenshot layers', () => {
  assert.match(css, /\.hero-gallery\s*\{\s*display:\s*grid/);
  assert.doesNotMatch(css, /\.screen-card--secondary\s*\{[^}]*position:\s*absolute/s);
  assert.doesNotMatch(css, /\.screen-card--primary\s*\{[^}]*z-index/s);
  assert.match(css, /\.code-preview--dashboard/);
  assert.match(css, /\.code-preview--dining/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.code-preview/);
});

test('account entry points are visible in the header, hero and closing section', () => {
  for (const html of [about, privacy, terms]) {
    assert.match(html, /href="\/auth\/login"/);
    assert.match(html, /href="\/auth\/register"/);
  }
  assert.match(about, /class="nav-actions"/);
  assert.match(about, /class="hero-actions"/);
  assert.match(about, /class="closing-actions"/);
  assert.match(about, /class="mobile-menu-panel"/);
});

test('footer is compact, centered and follows the in-app copyright and portfolio credit', () => {
  assert.match(about, /common\.copyright\.prefix[\s\S]*?<span id="copyright-year">2026<\/span>[\s\S]*?common\.copyright\.suffix/);
  assert.match(about, /https:\/\/rakibul-sec1\.vercel\.app\//);
  assert.match(about, /Designed &amp; Developed by/);
  assert.match(css, /\.footer-main\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*center/s);
  for (const html of [privacy, terms]) assert.match(html, /common\.copyright\.prefix[\s\S]*?<span id="copyright-year">2026<\/span>[\s\S]*?common\.copyright\.suffix/);
});

test('support email is only a mailto destination and is not visibly printed', () => {
  for (const html of [about, privacy, terms]) {
    assert.match(html, /href="mailto:support\.sec1\.info@gmail\.com"/);
    assert.ok(!visibleText(html).includes('support.sec1.info@gmail.com'));
  }
});

test('privacy and terms are centered single-column documents without side filters', () => {
  for (const html of [privacy, terms]) {
    assert.match(html, /class="legal-hero"/);
    assert.match(html, /class="legal-document"/);
    assert.match(html, /class="legal-sections"/);
    assert.doesNotMatch(html, /<aside|class="toc"|সূচিপত্র|এই নীতিতে যা আছে|শর্তাবলীর বিষয়/);
    assert.match(html, /class="legal-contact"/);
  }
  assert.match(css, /\.legal-document\s*\{[^}]*margin-inline:\s*auto/s);
  assert.match(css, /\.legal-hero\s*\{[^}]*text-align:\s*center/s);
  assert.doesNotMatch(privacy + terms, /legal-bottom-links/);
});

test('legal pages retain user-facing data, age and service terms without exposing internal infrastructure', () => {
  for (const phrase of ['নাম', 'ইমেইল', 'মোবাইল নম্বর', 'মিল', 'বাজার', 'জমা', 'খরচ', 'Telegram', 'Google Sign-In', 'প্রোফাইল ছবি', 'তথ্য সংরক্ষণ']) {
    assert.ok(privacy.includes(phrase), `privacy page should disclose ${phrase}`);
  }
  assert.match(privacy, /Google Sign-In সংযুক্ত করা হয়েছে এবং এটি ঐচ্ছিক/);
  assert.match(privacy, /Google আপনার পরিচয় যাচাই করে আপনার নাম, ইমেইল ঠিকানা/);
  assert.match(privacy, /Google Sign-In সংযুক্ত করা হয়েছে এবং এটি ঐচ্ছিক/);
  assert.match(privacy, /বয়স কমপক্ষে ১৮ বছর/);
  assert.doesNotMatch(privacy, /Supabase|Vercel|IndexedDB|User-Agent|ap-southeast-1|public bucket|openid|userinfo\.email|userinfo\.profile|জন্ম নিবন্ধন|জাতীয় পরিচয়পত্র|প্রকাশের আগে পূরণ করতে হবে/);
  assert.match(terms, /অ্যাপটি নিজে পেমেন্ট গেটওয়ে নয়/);
  assert.match(terms, /ভূমিকা ও অনুমতি/);
  assert.match(terms, /ওয়েবসাইটের সাধারণ ঠিকানা বা Hostel Life-এর পরিচিতি পেজ প্রকাশ্যে শেয়ার করা যায়/);
  assert.match(terms, /ব্যক্তিগত Join Code ও Invitation Link/);
});

test('responsive styles cover compact phones and reduced-motion preferences', () => {
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /@media \(max-width: 380px\)/);
  assert.match(css, /min-width: 320px/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(about, /data-i18n-key="about\.hero\.title"/);
});
