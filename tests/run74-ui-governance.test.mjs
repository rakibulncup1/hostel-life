import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Run74 leaves language and theme controls only on About and signed-in Profile', async () => {
  const [about, privacy, terms, header, drawer, auth, onboarding, profile, publicControls, languageRuntime] = await Promise.all([
    read('public/about.html'), read('public/privacy-policy.html'), read('public/terms-of-service.html'),
    read('src/components/Header.jsx'), read('src/components/MenuDrawer.jsx'),
    read('src/features/auth/AuthPage.jsx'), read('src/features/onboarding/OnboardingPage.jsx'),
    read('src/features/profile/ProfilePage.jsx'), read('public/landing-assets/public-controls.js'), read('public/language-runtime.js'),
  ]);
  assert.equal((about.match(/data-language-switch/g) || []).length, 1);
  assert.match(about, /data-theme-choice="dark"/);
  assert.doesNotMatch(privacy + terms, /data-language-switch|data-theme-choice=/);
  assert.match(privacy + terms, /public-controls\.js/);
  assert.doesNotMatch(header + drawer + auth, /LanguageSwitcher|EntryThemeSwitcher/);
  assert.match(onboarding, /LanguageSwitcher/);
  assert.match(profile, /LanguageSwitcher/);
  const superAdmin = await read('src/features/platform/SuperAdminPage.jsx');
  assert.match(superAdmin, /LanguageSwitcher compact className="platform-language-control"/);
  assert.match(profile, /setThemeChoice/);
  assert.match(publicControls, /hostel-life-theme/);
  assert.match(languageRuntime, /hostel-life-language-v1/);
});

test('dark palette is neutral and does not override light-theme styling', async () => {
  const css = await read('src/styles/run74-professional-polish.css');
  assert.match(css, /:root\[data-theme="dark"\]\s*\{/);
  assert.match(css, /--surface:\s*#191f24/);
  assert.match(css, /Run74 — neutralise inherited dark-theme accent cards/);
  assert.doesNotMatch(css, /:root\[data-theme="light"\]/);
});

test('desktop profile and member-detail layouts retain balanced sizing and vertical touch scrolling', async () => {
  const css = await read('src/styles/run74-professional-polish.css');
  assert.match(css, /profile-primary-grid\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(css, /member-period-summary-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /touch-action:\s*pan-y pinch-zoom/);
  assert.match(css, /\.app-main\s*\{\s*width:\s*100% !important/);
});

test('public About and legal pages provide consistent theme palettes and aligned legal widths', async () => {
  const [css, about, privacy, terms] = await Promise.all([
    read('public/landing-assets/public-experience.css'), read('public/about.html'),
    read('public/privacy-policy.html'), read('public/terms-of-service.html'),
  ]);
  assert.match(css, /:root\[data-theme="blue"\]/);
  assert.match(css, /\.legal-hero-inner\s*\{\s*max-width:\s*880px/);
  assert.match(about, /data-theme-choice="light"/);
  assert.match(privacy, /legal-hero-inner/);
  assert.match(terms, /legal-hero-inner/);
});

test('English market fallback and sample report meal-rate labels remain localisable', async () => {
  const [dining, translations, runtime] = await Promise.all([read('src/features/dining/DiningPage.jsx'), read('public/app-english-translations.js'), read('public/language-runtime.js')]);
  assert.match(dining, /market-buyer-readonly[^>]*>[\s\S]*?নিজের নামে/);
  assert.match(translations, /"নিজের নামে": "Under your own name"/);
  assert.match(runtime, /['"]about\.copy\.8eb4692fa0['"]\s*:\s*['"]Meal rate['"]/);
});

test('About dashboard and dining previews use matching responsive heights', async () => {
  const css = await read('public/landing-assets/public-experience.css');
  assert.match(css, /\.screen-card \.code-preview--dashboard,[\s\S]*?\.screen-card \.code-preview--dining/);
  assert.match(css, /min-height:\s*clamp\(330px, 31vw, 380px\)/);
  assert.match(css, /min-height:\s*clamp\(315px, 88vw, 355px\)/);
});
