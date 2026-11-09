import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const auth = read('src/features/auth/AuthPage.jsx');
const main = read('src/main.jsx');
const css = read('src/styles/auth-brand-center-v47.css');

test('login and registration show the centered Hostel Life logo and one-line name', () => {
  assert.match(auth, /<div className="auth-brand-lockup">[\s\S]*?<BrandMark size=\{64\} \/>[\s\S]*?<span className="auth-brand-name">Hostel Life<\/span>/);
  assert.match(css, /\.auth-brand-name[\s\S]*?white-space:\s*nowrap/);
  assert.match(css, /justify-content:\s*center !important/);
});

test('product quote is concise, centered and visible at desktop, tablet and mobile widths', () => {
  assert.match(auth, /auth-brand-quote">মিল, বাজার ও হিসাব—এক জায়গায়, স্বচ্ছতা ও আস্থার সঙ্গে।?<\/p>/);
  assert.match(css, /\.auth-brand-quote[\s\S]*?display:\s*block !important/);
  assert.match(css, /@media \(max-width:\s*640px\)/);
  assert.match(css, /@media \(min-width:\s*641px\) and \(max-width:\s*849px\)/);
  assert.match(css, /text-align:\s*center/);
});

test('brand redesign does not leak into compact email verification header', () => {
  assert.match(auth, /auth-brand-panel-compact/);
  assert.match(auth, /!minimal && <p className="auth-brand-quote"/);
  assert.match(css, /:not\(\.auth-brand-panel-compact\)/);
});

test('the centered brand stylesheet loads after previous auth styling', () => {
  assert.match(main, /styles\/ui-polish-v45\.css/);
  assert.match(main, /styles\/auth-brand-center-v47\.css/);
  assert.ok(main.indexOf('styles/auth-brand-center-v47.css') > main.indexOf('styles/ui-polish-v45.css'));
});
