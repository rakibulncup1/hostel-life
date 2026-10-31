import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const history = read('src/features/history/HistoryPage.jsx');
const dining = read('src/features/dining/DiningPage.jsx');
const manager = read('src/features/manager/ManagerPages.jsx');
const css = read('src/styles/ui-refresh.css');
const auth = read('src/contexts/AuthContext.jsx');
const app = read('src/app/App.jsx');
const onboarding = read('src/features/onboarding/OnboardingPage.jsx');
const identityError = read('src/features/account/IdentityErrorPage.jsx');
const offlineState = read('src/components/OfflineState.jsx');
const icon = read('src/components/Icon.jsx');
const bottomNav = read('src/components/BottomNav.jsx');

test('History information row shares desktop width with refresh and print actions', () => {
  assert.match(history, /className="history-title-footer"/);
  assert.match(css, /\.history-title-footer\s*\{[\s\S]*?display:\s*flex/);
  assert.match(css, /\.history-intro-info\s*\{[\s\S]*?max-width:\s*none/);
});

test('market date filters reserve separate columns for start, end and reset', () => {
  assert.match(history, /type="date" value=\{marketDateFrom\}/);
  assert.match(history, /type="date" value=\{marketDateTo\}/);
  assert.match(css, /\.market-history-filters \.history-filter-controls\s*\{[\s\S]*?repeat\(2, minmax\(145px, 1fr\)\) auto/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.market-history-filters \.history-filter-controls/);
});

test('Dining request history has a refined scoped heading and icon branding', () => {
  assert.match(dining, /request-history-header/);
  assert.match(dining, /আপনার মিলের ইতিহাস/);
  assert.match(dining, /icon="cooking-pot"/);
  assert.match(icon, /'cooking-pot':/);
  assert.match(icon, /'calendar-check':/);
  assert.match(icon, /'alert-circle':/);
  assert.match(icon, /'book-open':/);
  assert.match(icon, /'shield-check':/);
  assert.match(icon, /'user-check':/);
  assert.match(bottomNav, /key: 'dining',[^\n]*icon: 'cooking-pot'/);
});

test('Khala entries highlight the recipient member name without a new RPC', () => {
  assert.match(manager, /khala-ledger-recipient/);
  assert.match(manager, /row\.member_name/);
  assert.match(manager, /খালার পারিশ্রমিক/);
});

test('ranking badges have distinct top-three theme-aware styles', () => {
  assert.match(css, /\.ranking-card \.rank-number\.rank-1/);
  assert.match(css, /\.ranking-card \.rank-number\.rank-2/);
  assert.match(css, /\.ranking-card \.rank-number\.rank-3/);
});

test('month-close confirmation keeps the same action but shows a structured impact summary', () => {
  assert.match(manager, /className="month-close-confirmation"/);
  assert.match(manager, /month-close-confirm-summary/);
  assert.match(manager, /month-close-confirm-counts/);
  assert.match(manager, /onConfirm=\{\(\) => closeMonth\(futureWarning\)\}/);
});

test('offline recovery is user-triggered and does not add a timer or polling loop', () => {
  assert.match(offlineState, /window\.location\.reload\(\)/);
  assert.match(offlineState, /hostellife-bd\.vercel\.app/);
  assert.match(identityError, /আবার চেষ্টা করুন/);
  assert.match(identityError, /hostellife-bd\.vercel\.app/);
  assert.doesNotMatch(identityError, /setInterval|setTimeout/);
  assert.doesNotMatch(offlineState, /setInterval|setTimeout/);
});

test('identity fetch failure does not redirect a signed-in user into false onboarding', () => {
  assert.match(app, /if \(auth\.identityError\) return;/);
  assert.match(app, /auth\.identityError, auth\.membership/);
});

test('onboarding account switch clears only this device session and returns to login', () => {
  assert.match(onboarding, /signOutLocal/);
  assert.match(onboarding, /navigateTo\('\/auth\/login', true\)/);
  assert.match(auth, /signOut\(\{ scope: 'local' \}\)/);
});
