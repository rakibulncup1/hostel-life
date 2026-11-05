import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('privacy policy describes Hostel Life user data without exposing implementation details', async () => {
  const menu = await source('src/features/menu/MenuPages.jsx');
  const privacy = menu.split('export function PrivacyPolicyPage() {')[1]?.split('export function TermsPage() {')[0] || '';
  assert.ok(privacy.includes('সদস্য তালিকা'));
  assert.ok(privacy.includes('ব্যালেন্স'));
  assert.ok(privacy.includes('হিসাব ইতিহাস'));
  assert.ok(privacy.includes('ঐতিহাসিক রেকর্ড'));
  assert.doesNotMatch(privacy, /Supabase|PostgreSQL|database|ডাটাবেজ|SQL|RPC|API|Edge Function|hosting/i);
});

test('terms protect private invitation links while allowing public sharing of the app URL', async () => {
  const menu = await source('src/features/menu/MenuPages.jsx');
  const terms = menu.split('export function TermsPage() {')[1]?.split('const HOW_TO_USE_GROUPS')[0] || '';
  assert.match(terms, /ব্যক্তিগত আমন্ত্রণ ও Join Code সুরক্ষিত রাখুন/);
  assert.match(terms, /ব্যক্তিগত Invitation Link, Join Code/);
  assert.match(terms, /সাধারণ ওয়েবসাইটের ঠিকানা প্রকাশ্যে শেয়ার করা যায়/);
  assert.match(terms, /ভুয়া.*অ্যাকাউন্ট/);
  assert.match(terms, /যেকোনো সময়/);
});

test('how-to guide includes grouped questions and current Bangladesh meal/month deadlines', async () => {
  const menu = await source('src/features/menu/MenuPages.jsx');
  assert.match(menu, /const HOW_TO_USE_GROUPS = \[/);
  assert.match(menu, /<details className="howto-faq-item"/);
  assert.match(menu, /তার আগের দিন বাংলাদেশ সময় রাত ১০টার আগে সাধারণ অনুরোধ জমা দিতে হবে/);
  assert.match(menu, /বাংলাদেশ সময় রাত ৯টায়/);
  assert.match(menu, /রাত ৮টার পর/);
  assert.match(menu, /শীর্ষ খাদক/);
  assert.match(menu, /মিল শিট কোথায় পাব/);
  assert.match(menu, /রিপোর্ট ডাউনলোড কীভাবে করব/);
});

test('profile support label changes without changing its existing destination', async () => {
  const profile = await source('src/features/profile/ProfilePage.jsx');
  assert.match(profile, /হোস্টেল লাইফ সাপোর্ট/);
  assert.match(profile, /navigateTo\('\/app\/menu\/developer'\)/);
});

test('History gets the distinctive heading mark', async () => {
  const history = await source('src/features/history/HistoryPage.jsx');
  assert.match(history, /history-page-brand-mark/);
  assert.match(history, /স্বচ্ছ হিসাব/);
});

test('nested feature states expose an appropriate return route', async () => {
  const [menu, manager, dining, offline, shell] = await Promise.all([
    source('src/features/menu/MenuPages.jsx'),
    source('src/features/manager/ManagerPages.jsx'),
    source('src/features/dining/DiningPage.jsx'),
    source('src/components/OfflineState.jsx'),
    source('src/app/AppShell.jsx'),
  ]);
  assert.match(menu, /onClick=\{\(\) => navigateTo\('\/app\/dashboard'\)\}/);
  assert.match(manager, /feature-state-back/);
  assert.match(dining, /view === 'meal-request'/);
  assert.match(dining, /subpage-back-row/);
  assert.match(offline, /onBack &&/);
  assert.match(shell, /OfflineState onBack=\{\(\) => navigateTo\('\/app\/dashboard'\)\}/);
});
