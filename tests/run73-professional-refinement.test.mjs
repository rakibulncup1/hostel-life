import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Profile experience layout is actually loaded and keeps cards separated', () => {
  const main = read('src/main.jsx');
  const profileCss = read('src/styles/run73-professional-refinement.css');
  assert.match(main, /import '\.\/styles\/profile-experience-v1\.css';/);
  assert.match(main, /import '\.\/styles\/run73-professional-refinement\.css';/);
  assert.match(profileCss, /\.profile-experience \.profile-settings-grid\s*\{[^}]*gap:/s);
  assert.match(profileCss, /\.profile-experience \.profile-section-card\s*\{[^}]*border-radius: 20px/s);
  assert.match(profileCss, /\.profile-experience \.profile-detail-list > div\s*\{[^}]*min-height: 50px/s);
});

test('Dark theme exposes complete surface aliases and form-control contrast', () => {
  const css = read('src/styles/run73-professional-refinement.css');
  for (const token of ['--surface-raised:', '--surface-soft:', '--surface-elevated:', '--input-bg:', '--border:']) {
    assert.ok(css.includes(token), `missing theme token ${token}`);
  }
  assert.match(css, /:root\[data-theme="dark"\]\s*\{[\s\S]*?--bg: #0b1210;[\s\S]*?--surface: #121b17;[\s\S]*?--text: #e8f1eb;/);
  assert.match(css, /:root\[data-theme="dark"\] \.field-label input,[\s\S]*?color-scheme: dark;/);
  assert.match(css, /:root\[data-theme="dark"\] \.profile-experience \.profile-identity-card/);
});

test('English document titles update immediately when the language changes', () => {
  const app = read('src/app/App.jsx');
  assert.match(app, /const \[uiLanguage, setUiLanguage\]/);
  assert.match(app, /const isEnglish = uiLanguage === 'en'/);
  assert.match(app, /\['\/profile', 'Profile', 'প্রোফাইল'\]/);
  assert.match(app, /\}, \[pathname, uiLanguage\]\);/);
});

test('System theme follows operating-system changes while System is selected', () => {
  const app = read('src/app/App.jsx');
  assert.match(app, /matchMedia\?\.\('\(prefers-color-scheme: dark\)'\)/);
  assert.match(app, /getThemePreference\(\) === 'system'/);
  assert.match(app, /applyTheme\('system'\)/);
});

test('English copy includes the previously missed About labels and descriptive text', () => {
  const translations = read('public/app-english-translations.js');
  const keyedCopy = read('public/language-runtime.js');
  for (const phrase of [
    'ড্যাশবোর্ড · আজকের মিল',
    'ডাইনিং · প্রয়োজনীয় কাজ',
    'প্রতিদিনের অবস্থা এক নজরে',
    'সকালের মিল',
    'ম্যানেজার প্যানেল · নমুনা UI',
  ]) assert.ok(translations.includes(`"${phrase}"`), `missing translation for ${phrase}`);
  assert.ok(keyedCopy.includes("'about.copy.b8cc84d169': 'Rice'"));
  assert.ok(keyedCopy.includes("'about.copy.19adb8ceca': 'November 2026'"));
  assert.match(keyedCopy, /legal\.toc\.title': 'On this page'/);
  assert.match(keyedCopy, /'সব সদস্য': 'All members'/);
  for (const userItem of ['চাল', 'ডাল', 'সবজি']) {
    assert.doesNotMatch(translations, new RegExp(`\"${userItem}\"\\s*:`), `${userItem} must remain user content, not a global translation key`);
  }
});

test('Generated meal-sheet reports localise system labels without translating member names', () => {
  const managerPages = read('src/features/manager/ManagerPages.jsx');
  assert.match(managerPages, /const isEnglish = getUiLocale\(\) === 'en-US'/);
  assert.match(managerPages, /isEnglish \? 'Breakfast' : 'সকালের মিল'/);
  assert.match(managerPages, /isEnglish \? 'Member' : 'সদস্য'/);
  assert.match(managerPages, /escapeReportHtml\(memberTotal\.name\)/);
  assert.match(managerPages, /isEnglish \? 'All members' : 'সব সদস্য'/);
});

test('About product previews are enlarged and remain responsive on small screens', () => {
  const css = read('public/landing-assets/public-experience.css');
  assert.match(css, /Run73 — larger, clearer product previews/);
  assert.match(css, /\.about-page \.feature-image-frame \{ height: clamp\(205px/);
  assert.match(css, /\.about-page \.preview-action-tile \{ min-height: 112px/);
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*?\.about-page \.preview-stat-grid/);
});
