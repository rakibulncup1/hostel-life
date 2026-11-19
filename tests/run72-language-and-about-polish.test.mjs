import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('language switcher supports explicit Bangla and English selection through the shared runtime', () => {
  const source = read('src/components/LanguageSwitcher.jsx');
  assert.match(source, /variant === 'segmented'/);
  assert.match(source, /chooseLanguage\('bn'\)/);
  assert.match(source, /chooseLanguage\('en'\)/);
  assert.match(source, /HostelLifeI18n\?\.setLanguage\?\./);
  assert.match(source, /aria-pressed=\{language === 'bn'\}/);
  assert.match(source, /aria-pressed=\{language === 'en'\}/);
  assert.match(source, /data-no-translate/);
});

test('Profile provides clearly labelled two-language selection', () => {
  const source = read('src/features/profile/ProfilePage.jsx');
  assert.match(source, /LanguageSwitcher variant="segmented" withLabel className="profile-language-control"/);
});

test('navigation drawer keeps navigation actions without duplicating language settings', () => {
  const source = read('src/components/MenuDrawer.jsx');
  assert.doesNotMatch(source, /LanguageSwitcher|drawer-language-control/);
  assert.match(source, /onClick=\{\(\) => click\('logout'\)\}/);
});

test('code-built About previews use more readable type and preserve responsive sizing', () => {
  const source = read('public/landing-assets/public-experience.css');
  assert.match(source, /Run72 — larger, more readable code-built product previews/);
  assert.match(source, /\.preview-stat > span \{ font-size: clamp\(8px/);
  assert.match(source, /\.request-table-row \{ min-height: 34px; font-size: clamp\(8px/);
  assert.match(source, /@media \(max-width: 420px\)/);
});

test('language controls remain local and do not require database or network changes', () => {
  const source = read('src/components/LanguageSwitcher.jsx');
  assert.doesNotMatch(source, /fetch\(|supabase|localStorage\.setItem/);
  assert.match(source, /HostelLifeI18n\?\.setLanguage/);
});


test('all inventoried About-page copy and accessibility keys have explicit English translations', () => {
  const runtime = read('public/language-runtime.js');
  const inventory = read('PUBLIC_ABOUT_LOCALIZATION_KEYS_BN.md');
  const keys = [...inventory.matchAll(/- `([^`]+)` — /g)].map((match) => match[1]);
  assert.ok(keys.length > 100, 'the full About localization inventory should be present');
  for (const key of keys) {
    assert.ok(runtime.includes(`"${key}"`) || runtime.includes(`'${key}'`), `missing English translation for ${key}`);
  }
  assert.match(runtime, /about\.preview\.dashboard/);
  assert.match(runtime, /about\.meta\.description/);
});


test('About feature cards and management sections have complete English headings and descriptions', () => {
  const runtime = read('public/language-runtime.js');
  for (const key of [
    'about.features.eyebrow',
    'about.feature.meal.title',
    'about.feature.meal.description',
    'about.feature.market.title',
    'about.feature.market.description',
    'about.feature.deposit.title',
    'about.feature.deposit.description',
    'about.feature.allowance.title',
    'about.feature.allowance.description',
    'about.management.eyebrow',
    'about.management.title',
    'about.management.description',
    'about.management.requests.title',
    'about.management.requests.description',
    'about.management.menu.title',
    'about.management.menu.description',
    'about.closing.title',
    'about.closing.description',
  ]) {
    assert.ok(runtime.includes(`"${key}"`), `missing English section copy for ${key}`);
  }
  assert.match(runtime, /key\.match\(\/\^৳/);
  const about = read('public/about.html');
  assert.doesNotMatch(about, /<article class="feature-card" data-i18n-key="about\.feature\./);
});
