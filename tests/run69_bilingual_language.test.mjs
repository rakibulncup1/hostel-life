import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { LEGAL_DOCUMENTS } from '../src/content/legalDocuments.js';

const read = (file) => fs.readFileSync(file, 'utf8');
const runtime = read('public/language-runtime.js');
const externalContext = {};
vm.runInNewContext(read('public/app-english-translations.js'), { window: externalContext });
const translations = externalContext.HostelLifeEnglishTranslations || {};
function readRuntimeMap(name) {
  const expression = new RegExp(`const ${name} = (\\{[\\s\\S]*?\\n  \\});`);
  const match = runtime.match(expression);
  assert.ok(match, `missing ${name} dictionary`);
  return vm.runInNewContext(`(${match[1]})`, {});
}
const allTextTranslations = {
  ...readRuntimeMap('EN'),
  ...readRuntimeMap('MORE_EN'),
  ...readRuntimeMap('LEGAL_TEXT'),
  ...translations,
};

test('Run69 bilingual runtime defaults to Bangla and shares a stable language preference', () => {
  assert.match(runtime, /hostel-life-language-v1/);
  assert.match(runtime, /localStorage\.getItem\(STORAGE_KEY\) === 'en' \? 'en' : 'bn'/);
  assert.match(runtime, /window\.HostelLifeI18n = Object\.freeze/);
  assert.match(runtime, /window\.dispatchEvent\(new CustomEvent\(CHANGE_EVENT/);
  assert.match(runtime, /window\.addEventListener\('storage'/);
  assert.match(runtime, /data-language-switch/);
  assert.match(runtime, /currentLanguage === 'en' \? 'en' : 'bn-BD'/);
});

test('About owns the public language and theme controls; legal pages follow saved preferences', () => {
  const about = read('public/about.html');
  assert.equal((about.match(/data-language-switch/g) || []).length, 1);
  assert.match(about, /data-theme-choice="dark"/);
  for (const file of ['public/privacy-policy.html', 'public/terms-of-service.html']) {
    const html = read(file);
    assert.doesNotMatch(html, /data-language-switch|data-theme-choice=/);
    assert.match(html, /public-controls\.js/);
  }
  for (const file of ['public/about.html', 'public/privacy-policy.html', 'public/terms-of-service.html']) {
    const html = read(file);
    assert.match(html, /app-english-translations\.js/);
    assert.match(html, /language-runtime\.js/);
  }
});

test('Every canonical Privacy and Terms paragraph has an English translation', () => {
  for (const [kind, document] of Object.entries(LEGAL_DOCUMENTS)) {
    const values = [document.title, document.eyebrow, document.description, document.intro, document.contactTitle, document.contactText,
      ...document.sections.flatMap((section) => [section.title, section.toc, ...section.paragraphs])];
    for (const value of values) assert.ok(allTextTranslations[value], `${kind} missing English legal copy: ${value.slice(0, 90)}`);
  }
});

test('Profile, onboarding entry and the authenticated Super Admin panel expose the shared language control', () => {
  const profile = read('src/features/profile/ProfilePage.jsx');
  const onboarding = read('src/features/onboarding/OnboardingPage.jsx');
  const platform = read('src/features/platform/SuperAdminPage.jsx');
  assert.match(profile, /LanguageSwitcher/);
  assert.match(profile, /profile-language-section/);
  assert.match(onboarding, /LanguageSwitcher/);
  assert.match(platform, /LanguageSwitcher compact className="platform-language-control"/);
  for (const file of [
    'src/features/auth/AuthPage.jsx', 'src/features/auth/ForcedPasswordChange.jsx',
    'src/features/invites/HostelInvitePage.jsx', 'src/features/account/InactiveMembershipPage.jsx',
    'src/features/account/IdentityErrorPage.jsx', 'src/features/menu/AppDownloadPage.jsx',
  ]) assert.doesNotMatch(read(file), /LanguageSwitcher/ , `${file} should not duplicate the language setting`);
});

test('Changing language re-renders locale-aware React application values', () => {
  const app = read('src/app/App.jsx');
  assert.match(app, /HostelLifeI18n\?\.subscribe\?\.\(setUiLanguage\)/);
  assert.match(app, /Re-render locale-aware dates, numbers, currency/);
});

test('User-authored names and descriptions are protected from interface translation', () => {
  for (const [file, snippets] of Object.entries({
    'src/components/Header.jsx': ['data-user-content'],
    'src/components/MenuDrawer.jsx': ['data-user-content'],
    'src/features/profile/ProfilePage.jsx': ['data-user-content'],
    'src/features/history/HistoryPage.jsx': ['data-user-content'],
    'src/features/invites/HostelInvitePage.jsx': ['data-user-content'],
    'src/features/onboarding/OnboardingPage.jsx': ['data-user-content'],
  })) {
    const source = read(file);
    for (const snippet of snippets) assert.ok(source.includes(snippet), `${file} must preserve user-entered content`);
  }
});

test('Application locale helpers format dates, times, numbers and currency in the selected language', () => {
  for (const file of ['src/utils/date.js', 'src/utils/time.js', 'src/utils/number.js', 'src/utils/sevenDayMeals.js']) {
    assert.match(read(file), /getUiLocale\(\)/, `${file} must use the selected locale`);
  }
  assert.match(read('src/app/AppShell.jsx'), /toLocaleString\(getUiLocale\(/);
  assert.match(read('src/features/platform/SuperAdminPage.jsx'), /toLocaleString\(getUiLocale\(/);
  assert.match(read('src/features/manager/ManagerPages.jsx'), /getUiLocale\(\)/);
});

test('Reports and CSV translate interface labels while retaining member and market values', () => {
  const report = read('src/services/reportService.js');
  const share = read('src/utils/marketShare.js');
  assert.match(report, /translateReportUi\(column\.label\)/);
  assert.match(report, /translateReportMarkup/);
  assert.match(report, /getUiLocale\(\)/);
  assert.match(share, /isEnglish \? `Date:/);
  assert.match(share, /const itemName = String\(item\.item_name/);
  assert.match(share, /const buyerLabel = buyerName \? getMarketBuyerFirstName/);
  assert.match(share, /Total market:/);
});

test('Unknown user-authored text is not changed by global digit/month fallback', () => {
  assert.match(runtime, /Unknown text is intentionally[\s\S]{0,100}returned unchanged/);
  assert.match(runtime, /\[data-user-content\]/);
  assert.doesNotMatch(runtime, /'জানুয়ারি':'January'/);
  assert.doesNotMatch(runtime, /localized = toLatinDigits\(value\)/);
});

test('Language support adds no database migration or Supabase request', () => {
  assert.equal(fs.existsSync('supabase/migrations/Run69_bilingual_language.sql'), false);
  assert.match(read('src/components/LanguageSwitcher.jsx'), /localStorage\.getItem\('hostel-life-language-v1'\)/);
  assert.doesNotMatch(read('src/components/LanguageSwitcher.jsx'), /supabase|fetch\(/i);
});

test('Language runtime includes bounded translations for common dynamic UI templates', () => {
  assert.match(runtime, /function translateDynamicUi\(key\)/);
  assert.match(runtime, /নির্বাচিত তারিখসীমায়/);
  assert.match(runtime, /নতুন মাসের প্রথম মিলের দিন/);
  assert.match(runtime, /লাইন \(\[০-৯0-9\]\+\)/);
  assert.match(runtime, /কোড পাঠানো হ/);
  assert.match(runtime, /আগে থেকেই একটি সক্রিয় মিল অনুরোধ আছে/);
  assert.match(runtime, /চলমান মাসের শেষ তারিখের বাইরে/);
  assert.match(runtime, /নতুন মাসের প্রথম মিলের দিন \(\.\+\) ইতিমধ্যে পেরিয়েছে/);
});

test('Extended English coverage includes operational help, manager actions and language labels', () => {
  const required = [
    'ডাইনিং → “আমার মিল” বা “মিল অনুরোধ” → “নতুন মিল অনুরোধ” খুলুন। একটি দিন বা তারিখের পরিসর নির্বাচন করে প্রতিদিনের ব্রেকফাস্ট, লাঞ্চ ও ডিনারের মিলের পরিমাণ ঠিক করুন, তারপর জমা দিন। সফল সাধারণ অনুরোধ স্বয়ংক্রিয়ভাবে অনুমোদিত হয়; পরে “অনুরোধের ইতিহাস” থেকে স্ট্যাটাস দেখুন।',
    'ম্যানেজার মেনু → “বর্তমান মাস শেষ করুন” খুলুন। সার্ভারের প্রি-ফ্লাইট সতর্কতা, ভবিষ্যৎ তারিখের এন্ট্রি ও অপেক্ষমাণ অনুরোধ দেখে নিন। নিশ্চিত করলে বন্ধের দিন পর্যন্ত মিল সঙ্গে সঙ্গে ফাইনাল হবে; ভবিষ্যতের সক্রিয় অনুরোধ/মিল রেকর্ড এবং অপেক্ষমাণ বিশেষ আবেদন নিয়ম অনুযায়ী বাতিল হবে। পুরোনো ফাইনাল ইতিহাস অক্ষত থাকে।',
    'রেজিস্ট্রেশনের আগে ১৮+ বয়স নিশ্চিত করে ব্যবহারের শর্তাবলী ও গোপনীয়তা নীতিতে সম্মতি দিতে হবে।',
    'ভাষা বাংলায় পরিবর্তন করুন',
    'রক্ষণাবেক্ষণ বিজ্ঞপ্তি',
    'সদস্য নিষ্ক্রিয় হয়েছে; পুরোনো হিসাব অক্ষত আছে।',
  ];
  for (const phrase of required) assert.ok(allTextTranslations[phrase], `missing extended English translation: ${phrase.slice(0, 80)}`);
});

test('Dynamic English messages preserve user names and use the correct action wording', () => {
  const listeners = {};
  const document = {
    readyState: 'complete',
    documentElement: { nodeType: 1, dataset: {}, lang: 'bn-BD', querySelectorAll: () => [] },
    addEventListener: (name, callback) => { listeners[`doc:${name}`] = callback; },
    querySelectorAll: () => [],
    querySelector: () => null,
    createTreeWalker: () => ({ nextNode: () => null }),
  };
  const window = { addEventListener: (name, callback) => { listeners[`win:${name}`] = callback; }, dispatchEvent: () => {} };
  const localStorage = { getItem: () => 'en', setItem: () => {} };
  class MutationObserver { observe() {} disconnect() {} }
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
  class Element {}
  const context = {
    window, document, localStorage, MutationObserver, CustomEvent, Element,
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 }, NodeFilter: { SHOW_TEXT: 4 }, console, Intl, Date,
  };
  vm.createContext(context);
  vm.runInContext(read('public/app-english-translations.js'), context);
  vm.runInContext(runtime, context);
  const translate = window.HostelLifeI18n.translate;
  const closePrompt = translate('“আল-আমিন মেস” মেস বন্ধ করবেন? এই অ্যাকশন ডেটা মুছবে না। স্থায়ীভাবে মুছতে আলাদা Super Delete ব্যবহার করুন।');
  assert.match(closePrompt, /close hostel/);
  assert.match(closePrompt, /আল-আমিন মেস/);
  const createdMessage = translate('“নতুন মেস” মেস তৈরি হয়েছে এবং 2026-11-15 থেকে চলমান মাস শুরু হয়েছে।');
  assert.match(createdMessage, /was created/);
  assert.match(createdMessage, /November 15, 2026/);
  assert.match(createdMessage, /নতুন মেস/);
  assert.equal(translate('ব্যবহারকারীর ব্যক্তিগত নোট অপরিবর্তিত থাকবে'), 'ব্যবহারকারীর ব্যক্তিগত নোট অপরিবর্তিত থাকবে');
});
