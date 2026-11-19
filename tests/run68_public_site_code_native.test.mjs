import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('About page no longer renders application screenshots as product previews', async () => {
  const html = await read('../public/about.html');
  assert.equal((html.match(/class="code-preview /g) || []).length, 2);
  assert.equal((html.match(/class="mini-preview /g) || []).length, 4);
  assert.equal((html.match(/class="showcase-code-preview /g) || []).length, 3);
  assert.doesNotMatch(html, /(?:dashboard|dining|meal-request|market-entry|deposit|allowance|manager-requests|manager-menu|final-report-anonymized)\.webp/i);
  assert.equal((html.match(/<img\b/gi) || []).length, 2, 'only the brand mark is allowed inline; OG and favicon are metadata/link assets');
  assert.match(html, /og\/hostel-life-social\.png/);
  assert.match(html, /aria-label="ড্যাশবোর্ডের নমুনা/);
  assert.match(html, /ইন্টারফেস প্রিভিউ/);
  assert.doesNotMatch(html, /কোডে তৈরি|code-built/i);
});

test('Public About copy exposes stable localization hooks for future language support', async () => {
  const html = await read('../public/about.html');
  for (const key of [
    'about.hero.title',
    'about.hero.description',
    'about.features.title',
    'about.feature.meal.title',
    'about.feature.market.title',
    'about.management.title',
    'about.workflow.title',
    'about.closing.title',
  ]) assert.ok(html.includes(`data-i18n-key="${key}"`), `missing localization key ${key}`);
  assert.match(html, /data-i18n-key="common\.login"/);
  assert.match(html, /data-i18n-key="about\.mobile\.register"/);
  assert.match(html, /data-i18n-aria-label-key="about\.aria\./);
  assert.match(html, /data-i18n-content-key="about\.meta\.ogTitle"/);
  assert.ok((html.match(/data-i18n-key=/g) || []).length >= 150, 'visible About copy and code previews should have localization hooks');
  const inventory = await read('../PUBLIC_ABOUT_LOCALIZATION_KEYS_BN.md');
  assert.match(inventory, /About Page — Completed Localization Key Inventory/);
  assert.match(inventory, /about\.aria\./);
});

test('Public Privacy and Terms keep generated localization keys from canonical content', async () => {
  const [privacy, terms, generator, canonical] = await Promise.all([
    read('../public/privacy-policy.html'),
    read('../public/terms-of-service.html'),
    read('../scripts/generate-public-legal-pages.mjs'),
    read('../src/content/legalDocuments.js'),
  ]);
  assert.match(generator, /LEGAL_DOCUMENTS, LEGAL_LAST_UPDATED/);
  assert.match(generator, /data-i18n-key=/);
  assert.match(privacy, /data-i18n-key="privacy\.section\./);
  assert.match(terms, /data-i18n-key="terms\.section\./);
  assert.match(canonical, /export const LEGAL_DOCUMENTS/);
});

test('Desktop public login and registration frames are more compact without changing app layouts', async () => {
  const css = await read('../src/styles/run65-entry-windows.css');
  assert.match(css, /Run68 — compact desktop authentication frame/);
  assert.match(css, /@media \(min-width: 900px\)[\s\S]*?\.auth-page \.auth-shell:not\(\.auth-shell-compact\)[\s\S]*?width: min\(1060px, 100%\)/);
  assert.match(css, /min-height: min\(650px, calc\(100svh - 64px\)\)/);
  assert.doesNotMatch(css, /\.app-shell|\.dashboard-page|\.dining-page/);
});
