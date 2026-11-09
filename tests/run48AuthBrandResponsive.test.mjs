import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const css = read('src/styles/auth-brand-refinement-v48.css');
const main = read('src/main.jsx');
const auth = read('src/features/auth/AuthPage.jsx');

test('Run48 refinement is loaded after Run47 brand styles', () => {
  assert.ok(main.includes("import './styles/auth-brand-center-v47.css';"));
  assert.ok(main.includes("import './styles/auth-brand-refinement-v48.css';"));
  assert.ok(main.indexOf('auth-brand-refinement-v48.css') > main.indexOf('auth-brand-center-v47.css'));
});

test('desktop brand panel has a balanced full-height composition', () => {
  assert.match(css, /min-height:\s*clamp\(560px,\s*68vh,\s*700px\)/);
  assert.match(css, /border-right:\s*1px solid/);
  assert.match(css, /grid-template-columns:\s*minmax\(290px,\s*\.94fr\)\s+minmax\(0,\s*1\.06fr\)/);
  assert.match(css, /\.auth-brand-quote[\s\S]*?border-radius:\s*20px/);
});

test('mobile brand panel grows with content and avoids fixed-height cropping', () => {
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /min-height:\s*0\s*!important/);
  assert.match(css, /height:\s*auto\s*!important/);
  assert.match(css, /overflow:\s*visible/);
  assert.match(css, /width:\s*min\(560px,\s*100%\)/);
});

test('logo and product name remain in one responsive centered row on small screens', () => {
  assert.match(css, /flex-flow:\s*row nowrap\s*!important/);
  assert.match(css, /justify-content:\s*center\s*!important/);
  assert.match(css, /white-space:\s*nowrap/);
  assert.match(css, /@media\s*\(max-width:\s*360px\)/);
  assert.match(css, /font-size:\s*clamp\(21px,\s*6\.4vw,\s*23px\)/);
});

test('quote is visible and theme-token based without adding extra content', () => {
  assert.match(css, /\.auth-brand-quote\s*\{[\s\S]*?display:\s*block\s*!important/);
  assert.match(css, /background:\s*color-mix\(in srgb, var\(--surface\) 70%, var\(--primary-soft\)\)/);
  assert.match(auth, /auth-brand-quote/);
});

test('compact email verification brand is explicitly excluded', () => {
  assert.match(css, /\.auth-brand-panel:not\(\.auth-brand-panel-compact\)/);
  assert.match(css, /\.auth-shell:not\(\.auth-shell-compact\)/);
  assert.match(auth, /auth-brand-panel-compact/);
});
