import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.cwd());
const appCss = fs.readFileSync(path.join(root, 'src/styles/run78-visual-correction.css'), 'utf8');
const publicCss = fs.readFileSync(path.join(root, 'public/landing-assets/run78-public-overrides.css'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8');
const about = fs.readFileSync(path.join(root, 'public/about.html'), 'utf8');
test('Run78 does not introduce English font-size enlargement', () => {
  assert.doesNotMatch(appCss, /font-size\s*:\s*(1[5-9]|[2-9]\d)px/i);
  assert.match(appCss, /overflow-wrap:\s*anywhere/);
});
test('Dashboard dark metrics use neutral graphite surfaces', () => {
  assert.match(appCss, /\.dashboard-reimagined \.meal-card\.hero-card/);
  assert.match(appCss, /\.dashboard-reimagined \.account-grid > div/);
  assert.match(appCss, /background:\s*#39434b/);
});
test('About feature points use shrink-safe grid columns', () => {
  assert.match(publicCss, /grid-template-columns:\s*20px minmax\(0, 1fr\)/);
  assert.match(publicCss, /overflow-wrap:\s*anywhere/);
});
test('Public dark hero copy has readable dark surface and text', () => {
  assert.match(publicCss, /\.about-page \.hero-copy[\s\S]*?background:\s*#39434b/);
  assert.match(publicCss, /color:\s*#d2d9de/);
});
test('App and About load the isolated Run78 styles', () => {
  assert.match(main, /run78-visual-correction\.css/);
  assert.match(about, /run78-public-overrides\.css/);
});
