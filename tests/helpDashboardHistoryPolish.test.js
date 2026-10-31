import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const menu = readFileSync(new URL('../src/features/menu/MenuPages.jsx', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/features/dashboard/DashboardPage.jsx', import.meta.url), 'utf8');
const history = readFileSync(new URL('../src/features/history/HistoryPage.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles/ui-refresh.css', import.meta.url), 'utf8');

test('Help topics are collapsible first-level sections with question accordions inside', () => {
  assert.match(menu, /<details className="card howto-faq-group"/);
  assert.match(menu, /<details className="howto-faq-item"/);
  assert.match(menu, /প্রথমে বিষয় নির্বাচন করুন, তারপর পছন্দের প্রশ্ন খুলে উত্তর দেখুন/);
  assert.match(css, /\.howto-faq-group\[open\]/);
  assert.match(css, /\.howto-faq-item\[open\]/);
});

test('Help timing section retains all four approved Bangladesh time rules', () => {
  assert.match(menu, /রাত ১০টা/);
  assert.match(menu, /রাত ৯টা/);
  assert.match(menu, /Late \/ Correction/);
  assert.match(menu, /রাত ৮টার পর/);
  assert.match(menu, /বাংলাদেশ সময়/);
  assert.equal((menu.match(/<article className="howto-time-card(?:\s|")/g) || []).length, 4);
});

test('Dashboard member search filters the already-loaded member array locally', () => {
  assert.match(dashboard, /const \[memberSearchTerm, setMemberSearchTerm\] = useState\(''\)/);
  assert.match(dashboard, /const visibleMembers = useMemo\(/);
  assert.match(dashboard, /\.filter\(\(member\) => String\(member\?\.name/);
  assert.match(dashboard, /visibleMembers\.map\(/);
  assert.match(dashboard, /aria-label="সদস্যের নাম দিয়ে খুঁজুন"/);
  assert.match(dashboard, /অনুসন্ধান মুছুন/);
});

test('History keeps the same content and has dedicated mobile Dining-like heading and full-width info layout', () => {
  assert.match(history, /history-title-heading/);
  assert.match(history, /বাজার, জমা-খরচ ও আগের মাসের সংরক্ষিত হিসাব দেখুন/);
  assert.match(css, /\.history-title-heading\s*\{[\s\S]*?border-radius: 17px/);
  assert.match(css, /\.history-intro-info\s*\{[\s\S]*?width: 100%/);
  assert.match(css, /@media \(min-width: 851px\)[\s\S]*?\.history-title-actions \.secondary-button/);
});

test('member search adds no service, RPC, timer or polling calls', () => {
  assert.doesNotMatch(dashboard, /fetchDashboardData\(\{[^}]*memberSearchTerm/);
  assert.doesNotMatch(dashboard, /setInterval\(/);
});
