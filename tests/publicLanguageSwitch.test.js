import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const publicPages = [
  'public/about.html',
  'public/privacy-policy.html',
  'public/terms-of-service.html',
];

test('all pre-login public documents expose the shared Bengali-first language switcher', () => {
  for (const file of publicPages) {
    const html = read(file);
    assert.match(html, /<html lang="bn-BD">/);
    assert.match(html, /id="language-toggle"/);
    assert.match(html, /id="language-toggle-label">English</);
    assert.match(html, /\/landing-assets\/public-language\.js/);
  }
});

test('public language preference persists and updates document language accessibly', () => {
  const script = read('public/landing-assets/public-language.js');
  assert.match(script, /hostel-life-public-language/);
  assert.match(script, /localStorage\.getItem\(STORAGE_KEY\)/);
  assert.match(script, /localStorage\.setItem\(STORAGE_KEY, nextLanguage\)/);
  assert.match(script, /document\.documentElement\.lang = language === 'en' \? 'en' : 'bn-BD'/);
  assert.match(script, /aria-pressed/);
  assert.match(script, /Switch language to Bengali/);
  assert.match(script, /ভাষা ইংরেজিতে পরিবর্তন করুন/);
});

test('the English dictionary covers public copy and legal disclosures without touching app routes', () => {
  const script = read('public/landing-assets/public-language.js');
  for (const phrase of [
    'মেসের প্রতিদিনের কাজ হোক',
    'গোপনীয়তা নীতি',
    'ব্যবহারের শর্তাবলী',
    'তথ্য সংরক্ষণ ও আপনার নিয়ন্ত্রণ',
    'Google Sign-In বর্তমানে অ্যাপে সক্রিয় নয়।',
    'ব্যক্তিগত Join Code, Invitation Link',
    'তথ্যের নিরাপত্তা',
  ]) {
    assert.ok(script.includes(phrase), `English dictionary should include ${phrase}`);
  }
  assert.doesNotMatch(script, /\.rpc\(|\.from\(|fetch\(/);
});

test('legal documents expose all seven sections through a responsive contents navigator', () => {
  const ids = ['information', 'purpose', 'visibility', 'sharing', 'control', 'security', 'age'];
  const privacy = read('public/privacy-policy.html');
  const terms = read('public/terms-of-service.html');
  for (const id of ids) assert.match(privacy, new RegExp(`href="#${id}"`));
  for (const id of ['service', 'eligibility', 'account', 'roles', 'responsible', 'records', 'availability']) {
    assert.match(terms, new RegExp(`href="#${id}"`));
  }
  const css = read('public/landing-assets/public-experience.css');
  assert.match(css, /\.legal-contents-links/);
  assert.match(css, /@media \(max-width: 760px\)/);
});
