import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('landing page keeps both account actions clear across desktop and mobile', () => {
  const html = read('public/about.html');
  assert.ok((html.match(/href="\/auth\/login"/g) || []).length >= 3);
  assert.ok((html.match(/href="\/auth\/register"/g) || []).length >= 4);
  assert.match(html, /class="nav-actions"/);
  assert.match(html, /class="hero-actions"/);
  assert.match(html, /class="closing-actions"/);
  assert.match(html, /class="mobile-menu-panel"/);
});

test('landing screenshots represent existing app flows without invented UI', () => {
  const html = read('public/about.html');
  const dining = read('src/features/dining/DiningPage.jsx');
  const history = read('src/features/history/HistoryPage.jsx');
  for (const phrase of ['ড্যাশবোর্ড', 'আজকের মিল', 'ডাইনিং', 'মিল অনুরোধ', 'বাজার এন্ট্রি', 'ডিপোজিট', 'খালার টাকা']) {
    assert.ok(html.includes(phrase), `About page should include ${phrase}`);
  }
  for (const phrase of ['আমার মিল', 'বাজার এন্ট্রি', 'মিল অনুরোধ', 'ডিপোজিট']) {
    assert.ok(dining.includes(phrase), `Dining module should include ${phrase}`);
  }
  assert.ok(history.includes('বাজার ইতিহাস') || history.includes('হিসাব ইতিহাস'));
  assert.equal((html.match(/<img[^>]+src="\/landing-assets\//g) || []).length, 9);
  assert.doesNotMatch(html, /mock-sidebar|কৃত্রিম ডেমো ড্যাশবোর্ড/);
});

test('About footer follows the exact in-app copyright and developer portfolio', () => {
  const html = read('public/about.html');
  const appShell = read('src/app/AppShell.jsx');
  assert.match(html, /Copyright © <span id="copyright-year">2026<\/span> Hostel-Life\. All rights reserved\./);
  assert.match(html, /Designed &amp; Developed by <a href="https:\/\/rakibul-sec1\.vercel\.app\/" target="_blank" rel="noopener noreferrer">Rakibul Islam Samrat<\/a>/);
  assert.match(appShell, /Copyright © \{new Date\(\)\.getFullYear\(\)\} Hostel-Life\. All rights reserved\./);
  assert.match(appShell, /https:\/\/rakibul-sec1\.vercel\.app\//);
  assert.match(html, /class="footer-main"/);
  assert.doesNotMatch(html, /class="footer-about"|class="footer-columns"/);
});

test('public pages share a balanced palette, compact centered footer and responsive styles', () => {
  const css = read('public/landing-assets/public-experience.css');
  assert.match(css, /--green: #0c8f5b/);
  assert.match(css, /--blue-soft:/);
  assert.match(css, /--amber-soft:/);
  assert.match(css, /--paper:/);
  assert.match(css, /prefers-reduced-motion/);
  for (const file of ['public/privacy-policy.html', 'public/terms-of-service.html']) {
    const html = read(file);
    assert.match(html, /href="\/about"/);
    assert.match(html, /href="\/auth\/login"/);
    assert.match(html, /href="\/auth\/register"/);
    assert.doesNotMatch(html, /class="toc"|<aside/);
    assert.match(html, /class="legal-document"/);
    assert.match(css, /@media \(max-width: 760px\)/);
    assert.match(css, /\.legal-hero/);
    assert.match(html, /support\.sec1\.info@gmail\.com/);
    assert.match(html, file.includes('privacy-policy') ? /সর্বশেষ হালনাগাদ: ১২ নভেম্বর ২০২৬/ : /সর্বশেষ হালনাগাদ: ১২ নভেম্বর ২০২৬/);
    assert.doesNotMatch(html, /Supabase|ap-southeast-1|YOUR_PROJECT|প্রকাশের আগে পূরণ করতে হবে|জন্ম নিবন্ধন|জাতীয় পরিচয়পত্র|অভিভাবক/);
  }
});

test('policy accurately says Google Sign-In is currently inactive and the product is 18+ only', () => {
  const privacy = read('public/privacy-policy.html');
  const terms = read('public/terms-of-service.html');
  assert.match(privacy, /Google Sign-In সংযুক্ত নেই/);
  assert.match(privacy, /বয়স কমপক্ষে ১৮ বছর/);
  assert.match(terms, /বয়স কমপক্ষে ১৮ বছর/);
});

test('public pages retain clean document routing and shared stylesheet paths', () => {
  const vite = read('vite.config.js');
  const vercel = JSON.parse(read('vercel.json'));
  assert.match(vite, /hostel-life-public-document-aliases/);
  assert.ok(vercel.redirects.some((row) => row.source === '/' && row.destination === '/about' && row.permanent === true));
  assert.equal(vercel.rewrites.some((row) => row.source === '/' && row.destination === '/about.html'), false);
  for (const route of ['/about', '/privacy-policy', '/terms-of-service']) {
    assert.ok(vercel.rewrites.some((row) => row.source === route));
  }
  for (const file of ['public/about.html', 'public/privacy-policy.html', 'public/terms-of-service.html']) {
    assert.match(read(file), /href="\/landing-assets\/public-experience\.css"/);
  }
});
