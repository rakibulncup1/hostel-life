import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

test('Run110 app and public documents establish the saved language before first paint', () => {
  for (const file of ['index.html', 'public/about.html', 'public/privacy-policy.html', 'public/terms-of-service.html']) {
    const html = read(file);
    assert.match(html, /hostel-life-language-v1/);
    assert.match(html, /dataset\.language = language/);
    assert.match(html, /dataset\.locale = language === 'en' \? 'en-US' : 'bn-BD'/);
    assert.match(html, /fonts\.googleapis\.com/);
    assert.match(html, /fonts\.gstatic\.com/);
    assert.match(html, /family=Inter:[^"']*Noto\+Sans\+Bengali/);
  }
});

test('Run110 main typography layer selects dedicated Bengali and English stacks without resizing components', () => {
  const css = read('src/styles/run110-bilingual-typography.css');
  const main = read('src/main.jsx');
  assert.match(main, /run110-bilingual-typography\.css/);
  assert.match(css, /--hl-font-bengali:\s*"Noto Sans Bengali"/);
  assert.match(css, /--hl-font-latin:\s*"Inter"/);
  assert.match(css, /data-language="bn"/);
  assert.match(css, /data-language="en"/);
  assert.match(css, /--hl-body-leading:\s*1\.62/);
  assert.match(css, /--hl-body-leading:\s*1\.52/);
  assert.match(css, /font-variant-numeric:\s*tabular-nums lining-nums/);
  assert.doesNotMatch(css, /font-size\s*:|min-height\s*:|padding(?:-[a-z]+)?\s*:|grid-template-columns\s*:/);
});

test('Run110 public typography is applied after existing About and legal styles', () => {
  const css = read('public/landing-assets/bilingual-typography.css');
  assert.match(css, /html\[data-language="bn"\] body/);
  assert.match(css, /Noto Sans Bengali/);
  assert.match(css, /html\[data-language="en"\] body/);
  assert.match(css, /Inter/);
  for (const file of ['public/about.html', 'public/privacy-policy.html', 'public/terms-of-service.html']) {
    assert.match(read(file), /landing-assets\/bilingual-typography\.css/);
  }
});

test('Run110 locale helpers follow the runtime and first-paint document language consistently', () => {
  const source = read('src/i18n/locale.js');
  assert.match(source, /HostelLifeI18n\?\.getLanguage/);
  assert.match(source, /document\.documentElement\?\.dataset\?\.language/);
  assert.match(source, /getUiLanguage\(\) === 'en' \? 'en-US' : 'bn-BD'/);
  const number = read('src/utils/number.js');
  assert.match(number, /Intl\.NumberFormat\(getUiLocale\(\)/);
  assert.match(number, /`৳\$\{/);
});

test('Run110 language runtime synchronizes lang, data-language and data-locale on every switch', () => {
  const runtime = read('public/language-runtime.js');
  assert.match(runtime, /document\.documentElement\.lang = currentLanguage === 'en' \? 'en' : 'bn-BD'/);
  assert.match(runtime, /dataset\.language = currentLanguage/);
  assert.match(runtime, /dataset\.locale = currentLanguage === 'en' \? 'en-US' : 'bn-BD'/);
  assert.match(runtime, /\$\{toLatinDigits\(match\[1\]\)\} members/);
  assert.match(runtime, /Only visible members will be saved while search is active/);
});

test('Run110 exposes a local language switch in Super Admin without adding data or network requests', () => {
  const page = read('src/features/platform/SuperAdminPage.jsx');
  const component = read('src/components/LanguageSwitcher.jsx');
  assert.match(page, /LanguageSwitcher compact className="platform-language-control"/);
  assert.match(component, /HostelLifeI18n\?\.setLanguage\?\./);
  assert.doesNotMatch(component, /supabase|fetch\(/i);
});

test('Run110 reports use the bilingual font stack and wait briefly for loaded fonts before printing', () => {
  const report = read('src/services/reportService.js');
  assert.match(report, /fonts\.googleapis\.com/);
  assert.match(report, /Inter/);
  assert.match(report, /Noto Sans Bengali/);
  assert.match(report, /document\.fonts\?\.ready/);
  assert.match(report, /reportFontFamily/);
  assert.match(report, /REPORT_HEADER_HEIGHT_MM = 25\.4/);
  assert.match(report, /REPORT_HEADER_DPI = 96/);
  assert.match(report, /content:\$\{headerContent\}/);
  assert.match(report, /tagline: isEnglish \? 'Simple, transparent and organised management\.' : 'সহজ, স্বচ্ছ ও সুশৃঙ্খল ব্যবস্থাপনা'/);
  assert.match(report, /brandFontFamily: '"Inter", Arial, sans-serif'/);
  assert.match(report, /REPORT_HEADER_HEIGHT_MM = 25\.4/);
});

test('Run110 keeps copyright and developer branding in English in app and public footers', () => {
  const appShell = read('src/app/AppShell.jsx');
  assert.match(appShell, /<span data-no-translate>Copyright ©/);
  assert.match(appShell, /<span data-no-translate>Designed &amp; Developed by/);
  const appHeader = read('src/components/Header.jsx');
  assert.match(appHeader, /brand-product-name\" data-no-translate/);
  const typography = read('src/styles/run110-bilingual-typography.css');
  assert.match(typography, /brand-product-name/);
  for (const file of ['public/about.html', 'public/privacy-policy.html', 'public/terms-of-service.html']) {
    const html = read(file);
    assert.match(html, /footer-copyright" data-no-translate/);
    assert.match(html, /footer-credit" data-no-translate/);
  }
});

test('Run110 fills audited English gaps while keeping important safety and irreversible-action guidance', () => {
  const runtime = read('public/language-runtime.js');
  for (const phrase of [
    'এই নামে কোনো সদস্য মেলেনি। অন্য নাম লিখুন অথবা সার্চ মুছে দিন।',
    'নামের বানান পরিবর্তন করুন অথবা সার্চ মুছে সব সদস্য দেখুন।',
    'পরিশোধিত অর্থ',
    'নোটিশটি সদস্যদের অ্যাপ ও ইনবক্সে দেখাবে।',
    'একসাথে সর্বোচ্চ ২৫টি মেস বেছে স্থায়ীভাবে মুছতে পারবেন। নির্বাচন পৃষ্ঠা বদলালেও থাকবে।',
    'এই পরিবর্তন ফেরানো যাবে না। আগে ডেটাবেজ backup নিশ্চিত করুন।',
    'Google sign-in-এর আগে ১৮+ বয়স ও নীতিমালায় সম্মতি নিশ্চিত করুন।',
    'Google sign-in সম্পন্ন হয়েছে, কিন্তু profile প্রস্তুত করা যায়নি। আবার চেষ্টা করুন।',
    'আজ রাত ১০টার স্বাভাবিক cutoff শেষ হয়েছে। আজকের মিলের জন্য লেট অনুরোধ দিন; সেটি ম্যানেজারের অনুমোদনসাপেক্ষ।',
    'Google sign-in session পাওয়া যায়নি। আবার Login পেজ থেকে চেষ্টা করুন।',
    'Database bulk-delete response যাচাই করা যায়নি। Auth account cleanup চালানো হয়নি। Supabase result পরীক্ষা করুন।',
    'বন্ধ করার সঙ্গে সঙ্গেই আজকের হিসাবও চূড়ান্ত হবে—রাত ৯টার জন্য অপেক্ষা করতে হবে না। আজকের পরের তারিখের সক্রিয় অনুরোধ ও রেকর্ড এবং অপেক্ষমাণ লেট/সংশোধন অনুরোধ বাতিল হবে।',
  ]) assert.ok(runtime.includes(phrase), `missing audited translation: ${phrase}`);
});


test('Run110 provides an explicit English translation for every inventoried About key', () => {
  const runtime = read('public/language-runtime.js');
  const inventory = read('PUBLIC_ABOUT_LOCALIZATION_KEYS_BN.md');
  const keys = [...inventory.matchAll(/- `([^`]+)` — /g)].map((match) => match[1]);
  assert.ok(keys.length >= 150, 'the complete About translation inventory should be audited');
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
    assert.ok(new RegExp(`[\"']${escaped}[\"']\\s*:`).test(runtime), `missing explicit English translation: ${key}`);
  }
});
