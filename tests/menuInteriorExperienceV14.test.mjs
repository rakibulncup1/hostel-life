import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const menuDrawer = read('src/components/MenuDrawer.jsx');
const appRoutes = read('src/app/App.jsx');
const appShell = read('src/app/AppShell.jsx');
const css = read('src/styles/menu-interior-experience-v14.css');
const main = read('src/main.jsx');
const history = read('src/features/history/HistoryPage.jsx');
const dining = read('src/features/dining/DiningPage.jsx');

test('all common and system drawer entries still resolve to existing route pages', () => {
  const expected = [
    'meal-sheet', 'archive', 'reports', 'members', 'khala-money-view',
    'top-eater', 'top-shopper', 'top-depositor', 'privacy-policy', 'terms',
    'how-to-use', 'app-download', 'telegram', 'developer',
  ];
  for (const key of expected) {
    assert.ok(menuDrawer.includes(`key: '${key}'`), `drawer item ${key} remains present`);
  }
  for (const route of [
    '/app/menu/members', '/app/menu/khala-money-view', '/app/menu/top-eater',
    '/app/menu/top-shopper', '/app/menu/top-depositor', '/app/menu/developer',
    '/app/menu/privacy-policy', '/app/menu/terms', '/app/menu/how-to-use',
    '/app/menu/app-download', '/app/menu/telegram', '/app/menu/reports',
    '/app/menu/meal-sheet', '/app/menu/archive',
  ]) assert.ok(appRoutes.includes(`'${route}'`) || appRoutes.includes(`"${route}"`) || appRoutes.includes(`pathname === '${route}'`), `route ${route} is mapped`);
});

test('primary and assistant manager menu actions remain mapped without changing authorization', () => {
  for (const key of ['current-month-close', 'new-month', 'change-manager', 'assistant-managers', 'hostel-settings', 'send-notification', 'khala-money', 'join-requests', 'member-management']) {
    assert.ok(menuDrawer.includes(`key: '${key}'`), `manager drawer action ${key} remains present`);
  }
  for (const route of [
    '/app/menu/current-month-close', '/app/menu/new-month', '/app/menu/change-manager',
    '/app/menu/assistant-managers', '/app/menu/hostel-settings', '/app/menu/khala-money',
    '/app/menu/member-management', '/app/menu/join-requests',
  ]) assert.ok(appRoutes.includes(route), `manager route ${route} remains mapped`);
  assert.match(appShell, /if \(key === 'logout'\)/, 'logout still uses the existing secure sign-out action');
});

test('menu interior theme layer covers light, blue and subdued dark surfaces', () => {
  assert.match(css, /\.menu-route\s*\{/);
  assert.match(css, /:root\[data-theme="blue"\] \.menu-route/);
  assert.match(css, /:root\[data-theme="dark"\] \.menu-route/);
  assert.match(css, /--menu-page-accent-soft/);
  assert.match(css, /--menu-page-violet-soft/);
  assert.match(css, /--menu-page-coral-soft/);
});

test('nested member, ranking, finance, archive, report, help and notification surfaces have theme treatments', () => {
  for (const selector of [
    '.all-member-card', '.member-stats-grid', '.khala-public-row', '.ranking-row',
    '.policy-document-card', '.howto-faq-group', '.current-hostel-notice-card',
    '.manager-form-card', '.assistant-choice-card', '.manager-join-request-row',
    '.report-option', '.report-table-wrap', '.archive-correction-section',
    '.telegram-connection-card', '.modal-panel',
  ]) assert.ok(css.includes(selector), `theme treatment exists for ${selector}`);
});

test('new menu stylesheet is loaded after the existing accepted visual layers', () => {
  assert.ok(main.includes("import './styles/menu-interior-experience-v14.css';"));
  assert.ok(main.indexOf("import './styles/menu-interior-experience-v14.css';") > main.indexOf("import './styles/profile-finish-v13.css';"));
});

test('History mobile refresh and PDF actions share the available width equally', () => {
  assert.match(history, /history-title-actions \$\{tab !== 'months' \? 'has-export-action' : 'single-action'\}/);
  assert.match(css, /\.history-title-actions\.has-export-action\s*\{[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.history-title-actions\.has-export-action > \.secondary-button[\s\S]*width:\s*100%/);
});

test('History dialogs lock document scroll and keep the detail surface independently scrollable', () => {
  assert.match(history, /const historyModalOpen = Boolean\(marketDetail \|\| marketEdit \|\| marketVoid \|\| transactionDetail \|\| transactionEdit \|\| detailLoading\)/);
  assert.match(history, /body\.style\.position = 'fixed'/);
  assert.match(history, /root\.style\.overscrollBehavior = 'none'/);
  assert.match(history, /window\.scrollTo\(0, scrollY\)/);
  assert.match(css, /\.history-market-detail-modal[\s\S]*overflow-y:\s*auto[\s\S]*overscroll-behavior:\s*contain/);
});

test('Dining member and manager meal-request pages share the polished section heading', () => {
  assert.match(dining, /function SectionHeader\(\{ eyebrow, title, description, icon, className = '' \}\)/);
  assert.match(dining, /className="dining-request-hub-heading"/);
  assert.match(css, /\.dining-request-hub-heading/);
});
