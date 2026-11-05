import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');

test('desktop About hero keeps the dashboard preview aligned with the main headline', () => {
  const css = read('public/landing-assets/public-experience.css');
  assert.match(css, /@media \(min-width: 761px\)\s*\{[\s\S]*?\.about-page \.hero-grid\s*\{\s*align-items:\s*start;/);
  assert.match(css, /\.about-page \.hero h1\s*\{\s*margin-top:\s*16px;/);
  assert.match(css, /\.about-page \.hero-gallery\s*\{\s*padding:\s*50px 0 16px;/);
  assert.match(css, /\.about-page \.hero\s*\{\s*padding-block:\s*clamp\(40px, 4vw, 56px\) clamp\(44px, 4\.5vw, 62px\);/);
});

test('mobile About hero retains its single-column layout and natural screenshot sizing', () => {
  const css = read('public/landing-assets/public-experience.css');
  assert.match(css, /@media \(max-width: 760px\)\s*\{[\s\S]*?\.about-page \.hero-grid\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/);
  assert.match(css, /\.screen-card img\s*\{\s*width:\s*100%;\s*height:\s*auto;\s*object-fit:\s*contain;/);
});

test('About hero and daily-feature copy remain concise and scannable', () => {
  const html = read('public/about.html');
  assert.ok(html.includes('মেসের দৈনন্দিন ব্যবস্থাপনা'));
  assert.ok(html.includes('দৈনিক মিল, বাজারের খরচ ও সদস্যদের জমার তথ্য রাখুন এক জায়গায়।'));
  assert.ok(html.includes('মিল, বাজার ও জমার জন্য আলাদা অংশ—প্রয়োজনীয় তথ্য যোগ করুন'));
  assert.ok(html.includes('<strong>দৈনিক মিল</strong><small>মিল, অনুরোধ ও সংশোধন</small>'));
});
