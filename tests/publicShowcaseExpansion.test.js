import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('About page includes real manager, navigation and anonymized final-report screenshots', () => {
  const html = read('public/about.html');
  for (const asset of [
    'manager-requests.webp',
    'manager-menu.webp',
    'final-report-anonymized.webp',
  ]) {
    assert.ok(fs.existsSync(path.join(root, 'public/landing-assets', asset)), `${asset} must exist`);
    assert.ok(html.includes(`/landing-assets/${asset}`), `${asset} must be shown on About`);
  }
  assert.match(html, /মিলের অনুরোধ যাচাই ও অনুমোদন/);
  assert.match(html, /দায়িত্ব অনুযায়ী সাজানো ব্যবস্থাপনা মেনু/);
  assert.match(html, /মাসিক হিসাবের পূর্ণাঙ্গ প্রতিবেদন/);
  assert.match(html, /alt="ব্যক্তিগত পরিচয় গোপন করা Hostel Life-এর মাসিক ফাইনাল রিপোর্ট/);
  assert.match(html, /ফাইনাল রিপোর্ট · পরিচয় গোপন করা নমুনা/);
});

test('App download actions use the existing PWA install page on all public entry points', () => {
  for (const file of ['public/about.html', 'public/privacy-policy.html', 'public/terms-of-service.html']) {
    const html = read(file);
    assert.match(html, /href="\/app\/menu\/app-download"/);
    assert.match(html, /অ্যাপ ডাউনলোড/);
  }
  const page = read('src/features/menu/AppDownloadPage.jsx');
  assert.match(page, /useInstallPromptContext/);
  assert.match(page, /useInstallPromptContext\(\)/);
  assert.match(page, /Install to Home Screen|Install app|ইনস্টল/);
});

test('only the informational App Download route bypasses authentication; other app routes remain guarded', () => {
  const app = read('src/app/App.jsx');
  assert.match(app, /if \(pathname === '\/app\/menu\/app-download'\) return;/);
  assert.match(app, /if \(pathname === '\/app\/menu\/app-download'\) return withPublicCommunications\(<AppDownloadPage \/>\);/);
  assert.match(app, /if \(!auth\.isAuthenticated\) return withPublicCommunications\(<AuthPage pathname="\/auth\/login" \/>\);/);
  assert.match(app, /resolveAppPage\(pathname, auth\.isManager, hasClosedMonthAccess\)/);
  assert.match(app, /isManager \|\| hasClosedMonthAccess/);
  assert.match(app, /pathname === '\/app\/menu\/app-download'\) title = 'Hostel Life — অ্যাপ ডাউনলোড'/);
});

test('root URL redirects to About, while Vite and all public paths remain configured', () => {
  const config = JSON.parse(read('vercel.json'));
  assert.deepEqual(config.redirects.find((item) => item.source === '/'), {
    source: '/', destination: '/about', permanent: true,
  });
  assert.equal(config.rewrites.some((item) => item.source === '/' && item.destination === '/about.html'), false);
  for (const route of ['/about', '/privacy-policy', '/terms-of-service', '/app/(.*)']) {
    assert.ok(config.rewrites.some((item) => item.source === route), `${route} rewrite should remain`);
  }
  assert.match(read('vite.config.js'), /\['\/',\s*'\/about\.html'\]/);
  assert.match(read('public/about.html'), /rel="canonical" href="https:\/\/hostellife-bd\.vercel\.app\/about"/);
});

test('Google authentication is still disclosed as inactive and future scope is conditional', () => {
  const privacy = read('public/privacy-policy.html');
  const terms = read('public/terms-of-service.html');
  assert.match(privacy, /Google Sign-In বর্তমানে অ্যাপে সক্রিয় নয়/);
  assert.match(privacy, /এই মুহূর্তে Google-এর মাধ্যমে লগইন বা Google অ্যাকাউন্টের তথ্য সংগ্রহ করা হয় না/);
  assert.match(privacy, /Gmail, Drive বা অন্য Google content access করার অনুমতি/);
  assert.match(terms, /বর্তমানে Google Sign-In চালু নেই/);
});
