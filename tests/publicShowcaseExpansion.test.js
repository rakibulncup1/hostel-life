import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('About manager, menu and report panels are semantic code-built previews', () => {
  const html = read('public/about.html');
  assert.match(html, /class="showcase-code-preview request-preview"/);
  assert.match(html, /class="showcase-code-preview menu-preview"/);
  assert.match(html, /class="showcase-code-preview report-preview"/);
  assert.match(html, /মিলের অনুরোধ যাচাই ও অনুমোদন/);
  assert.match(html, /দায়িত্ব অনুযায়ী সাজানো ব্যবস্থাপনা মেনু/);
  assert.match(html, /মাসিক হিসাবের পূর্ণাঙ্গ প্রতিবেদন/);
  assert.match(html, /নমুনা তথ্য · ব্যক্তিগত পরিচয় নেই/);
  assert.doesNotMatch(html, /manager-requests\.webp|manager-menu\.webp|final-report-anonymized\.webp/);
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
  assert.match(app, /resolveAppPage\(pathname, auth\.isManager\)/);
  assert.match(app, /pathname === '\/app\/menu\/archive'\) return <ArchiveCorrectionPage \/>/);
  assert.doesNotMatch(app, /isManager \|\| hasClosedMonthAccess/);
  assert.match(app, /\['\/menu\/app-download', 'Download App', 'অ্যাপ ডাউনলোড'\]/);
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

test('Google Sign-In is optional and its identity-data and registration rules are disclosed', () => {
  const privacy = read('public/privacy-policy.html');
  const terms = read('public/terms-of-service.html');
  assert.match(privacy, /Google Sign-In সংযুক্ত করা হয়েছে এবং এটি ঐচ্ছিক/);
  assert.match(privacy, /Google আপনার পরিচয় যাচাই করে আপনার নাম, ইমেইল ঠিকানা/);
  assert.match(privacy, /Google Sign-In সংযুক্ত করা হয়েছে এবং এটি ঐচ্ছিক/);
  assert.match(terms, /Google Sign-In ঐচ্ছিক/);
});
