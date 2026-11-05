import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('About page uses clearer Bengali copy for the daily workflow and product showcase', () => {
  const html = read('public/about.html');
  for (const phrase of [
    'মেসের প্রতিদিনের কাজ হোক',
    'দৈনন্দিন কাজ, আলাদা ও সহজ ব্যবস্থায়',
    'তথ্য সংরক্ষণ থেকে পর্যালোচনা—মাসিক প্রতিবেদন পর্যন্ত',
    'অ্যাকাউন্ট থেকে মাসিক হিসাব—সহজ তিন ধাপে',
    'মিলের অনুরোধ যাচাই ও অনুমোদন',
    'দায়িত্ব অনুযায়ী সাজানো ব্যবস্থাপনা মেনু',
    'মাসিক হিসাবের পূর্ণাঙ্গ প্রতিবেদন',
    'দৈনন্দিন তথ্য সংরক্ষণ',
    'হিসাব যাচাই ও প্রতিবেদন',
  ]) assert.ok(html.includes(phrase), `About page should include: ${phrase}`);
  assert.doesNotMatch(html, /শুধু এন্ট্রি নয়—পর্যালোচনা থেকে মাসিক রিপোর্টও|যে কাজগুলো প্রতিদিন লাগে, সেগুলোই আগে|শুরু থেকে হিসাব দেখা—একটি সহজ ধারা/);
});

test('bottom and hero login actions remain readable without hover and support keyboard focus', () => {
  const html = read('public/about.html');
  const css = read('public/landing-assets/public-experience.css');
  assert.match(html, /class="closing-actions"[\s\S]*?class="btn btn-secondary" href="\/auth\/login">অ্যাকাউন্টে প্রবেশ করুন/);
  assert.match(css, /\.hero-actions \.btn-secondary,[\s\S]*?\.closing-actions \.btn-secondary\s*\{[^}]*background:\s*#eaf5ee;[^}]*color:\s*#075f3e;/);
  assert.match(css, /\.closing-actions \.btn-secondary:hover/);
  assert.match(css, /\.closing-actions \.btn-secondary:focus-visible/);
});

test('the three workflow steps and service-scope note use responsive, bordered cards', () => {
  const html = read('public/about.html');
  const css = read('public/landing-assets/public-experience.css');
  assert.equal((html.match(/class="workflow-card"/g) || []).length, 3);
  assert.match(html, /class="product-note"/);
  assert.match(css, /\.workflow-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.workflow-card\s*\{[^}]*border:\s*1px solid/);
  assert.match(css, /\.product-note\s*\{[^}]*border:\s*1px solid/);
  assert.match(css, /@media \(max-width: 760px\)\s*\{[^}]*\.workflow-grid\s*\{\s*grid-template-columns:\s*1fr/);
});
