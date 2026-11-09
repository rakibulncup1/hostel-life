import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const auth = read('src/features/auth/AuthPage.jsx');
const manager = read('src/features/manager/ManagerPages.jsx');
const menu = read('src/features/menu/MenuPages.jsx');
const history = read('src/features/history/HistoryPage.jsx');
const css = read('src/styles/ui-polish-v43.css');
const main = read('src/main.jsx');

test('auth brand uses one Bengali wordmark and no artificial English submark or sparkle badge', () => {
  assert.match(auth, /auth-brand-name">হোস্টেল লাইফ/);
  assert.doesNotMatch(auth, /MESS MANAGEMENT|HOSTEL LIFE|auth-brand-highlight|হিসাব ও ব্যবস্থাপনা, এক জায়গায়/);
  assert.match(css, /\.auth-page \.auth-brand-panel::after \{ display: none !important; \}/);
  assert.match(css, /\.auth-page \.auth-brand-mark \{/);
});

test('finance feature guidance is rendered as a quiet inline hint rather than a card', () => {
  for (const snippet of [
    'className="finance-context-note" icon="calendar-check"',
    'className="finance-context-note finance-context-note-warning" tone="warning"',
    'className="finance-context-note" icon="wallet"',
    'className="finance-context-note finance-context-note-warning" tone="warning" icon="archive"',
    'className="finance-context-note" icon="book-open"',
    'className="finance-context-note" icon="download"',
  ]) assert.ok(manager.includes(snippet), `missing finance note: ${snippet}`);
  assert.match(menu, /className="finance-context-note" icon="activity"/);
  assert.match(menu, /className="finance-context-note" icon="archive"/);
  assert.match(css, /\.info-panel\.finance-context-note\s*\{[\s\S]*?border: 0;[\s\S]*?background: transparent;/);
  assert.match(css, /\.finance-context-note-warning/);
});

test('history accounting intro is no longer a large colored callout', () => {
  assert.match(history, /history-intro-info finance-context-note-inline/);
  assert.match(css, /\.history-intro-info\.finance-context-note-inline\s*\{[\s\S]*?border: 0;[\s\S]*?background: transparent;/);
});

test('verification remains email-visible with one OTP input and existing return/resend flow', () => {
  const start = auth.indexOf('{otpStep ? (');
  const end = auth.indexOf(') : (', start);
  const branch = auth.slice(start, end);
  assert.match(branch, /auth-verification-email/);
  assert.match(branch, /\{email\}/);
  assert.equal((branch.match(/className="auth-otp-input"/g) || []).length, 1);
  assert.match(branch, /Spam বা Promotions/);
  assert.match(branch, /auth-otp-countdown/);
  assert.match(branch, /রেজিস্ট্রেশনে ফিরে যান/);
  assert.match(css, /auth-shell-verification \.auth-otp-input/);
});

test('Run43 stylesheet is loaded after all previous UI layers', () => {
  assert.match(main, /styles\/ui-polish-v43\.css/);
  assert.ok(main.indexOf('styles/ui-polish-v42.css') < main.indexOf('styles/ui-polish-v43.css'));
});
