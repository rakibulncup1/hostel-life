import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dining = readFileSync(new URL('../src/features/dining/DiningPage.jsx', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../src/features/auth/AuthPage.jsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles/dining-auth-polish-v44.css', import.meta.url), 'utf8');

test('manager Dining routes use a manager-only presentation scope', () => {
  assert.match(dining, /const managerPageStackClass = managerDiningUi \? 'page-stack manager-dining-view' : 'page-stack'/);
  assert.match(dining, /className=\{`page-stack dining-stack \$\{managerDiningUi \? 'manager-dining-view' : ''\}`\}/);
  for (const view of ['late-request', 'request-history', 'meal-request', 'market', 'admin-entry', 'admin-manual-request', 'manager-meal', 'manager-request', 'deposit', 'other-expense']) {
    const index = dining.indexOf(`if (view === '${view}')`);
    assert.notEqual(index, -1, `Expected ${view} route`);
    assert.match(dining.slice(index, index + 1400), /managerPageStackClass/ , `Expected manager style wrapper on ${view}`);
  }
});

test('Market Entry has one combined period/context guidance panel', () => {
  const market = dining.slice(dining.indexOf('function MarketEntryForm'), dining.indexOf('function ManagerMealEntry'));
  assert.match(market, /periodNotStarted \? \([\s\S]*?<InfoPanel tone="warning" icon="calendar"/);
  assert.match(market, /: isManager \? \([\s\S]*?<InfoPanel icon="shopping-basket">বাজারকারীর নাম/);
  assert.match(market, /: \([\s\S]*?<InfoPanel icon="shopping-basket">তারিখ ও বাজারকারীর তথ্য দিয়ে আইটেম যোগ করুন/);
  assert.doesNotMatch(dining.slice(dining.indexOf('function MarketEntryForm'), dining.indexOf('function ManagerMealEntry')), /<div className="form-hint period-start-notice"/);
});

test('the three My Meal inner screens avoid duplicate manager guidance while member guidance remains', () => {
  const editor = dining.slice(dining.indexOf('function MealRequestEditor'), dining.indexOf('function RequestHistory'));
  const history = dining.slice(dining.indexOf('function RequestHistory'), dining.indexOf('function MarketEntryForm'));
  const late = dining.slice(dining.indexOf('function LateMealRequestForm'), dining.indexOf('function ManualMemberMealRequest'));
  assert.match(editor, /!managerMode && <InfoPanel/);
  assert.match(history, /!managerMode && <InfoPanel/);
  assert.match(late, /managerMode = false/);
  assert.match(late, /managerMode \? \(/);
  assert.match(late, /!managerMode && \(periodLoading/);
  assert.match(late, /!managerMode && <div className="manager-warning-box late-request-warning-box"/);
  const route = dining.slice(dining.indexOf("if (view === 'late-request')"), dining.indexOf("if (view === 'request-history')"));
  assert.match(route, /managerMode=\{managerDiningUi\}/);
});

test('Deposit and Other Expense fold period guidance into their single panel', () => {
  const deposit = dining.slice(dining.indexOf('function ManagerDepositForm'), dining.indexOf('function ManagerOtherExpenseForm'));
  const expense = dining.slice(dining.indexOf('function ManagerOtherExpenseForm'), dining.indexOf('export function DiningPage'));
  assert.match(deposit, /periodStartNotice \|\| 'সদস্য, তারিখ ও জমার পরিমাণ যাচাই করে সংরক্ষণ করুন।'/);
  assert.match(expense, /periodStartNotice \|\| 'এই খরচ নির্বাচিত সদস্যের হিসাব থেকে বাদ যাবে।/);
  assert.doesNotMatch(deposit + expense, /className="form-hint period-start-notice"/);
});

test('Authentication brand contains only the centered English wordmark beside the app mark', () => {
  assert.match(auth, /<BrandMark size=\{64\} \/>/);
  assert.match(auth, /<span className="auth-brand-name">Hostel Life<\/span>/);
  assert.doesNotMatch(auth, /হোস্টেল লাইফ|মেস পরিচালনা, আরও গোছানো|মিল, বাজার ও সদস্যের হিসাব সহজে পরিচালনা করুন/);
  assert.match(styles, /\.auth-page \.auth-brand-lockup\s*\{[^}]*flex-direction:\s*column/s);
});

test('Run44 stylesheet is loaded after the Run43 design layer', () => {
  assert.ok(main.indexOf("import './styles/ui-polish-v43.css';") < main.indexOf("import './styles/dining-auth-polish-v44.css';"));
});
