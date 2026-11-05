import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');

test('About page uses short, scannable Bengali copy instead of long introductory paragraphs', () => {
  const html = read('public/about.html');
  assert.match(html, /দৈনিক মিল, বাজারের খরচ ও সদস্যদের জমার তথ্য রাখুন এক জায়গায়/);
  assert.match(html, /ম্যানেজার অনুরোধ যাচাই করেন, দায়িত্ব অনুযায়ী কাজ পরিচালনা করেন এবং মাসিক হিসাব দেখেন/);
  assert.match(html, /তিনটি ধাপেই দৈনন্দিন রেকর্ড থেকে মাসিক সারসংক্ষেপে পৌঁছান/);
  assert.doesNotMatch(html, /মেসের সব হিসাব—দৈনিক মিল ও অনুরোধ, বাজারের খরচ, সদস্যদের জমা এবং মাসিক রেকর্ড—এক জায়গায় সংরক্ষণ ও পর্যালোচনা করুন/);
  assert.doesNotMatch(html, /প্রকাশ্য নমুনায় ব্যক্তিগত নাম ও যোগাযোগের পরিচয় গোপন রাখা হয়েছে; প্রদর্শিত হিসাবের অঙ্ক অপরিবর্তিত/);
});

test('About page desktop content uses a wider canvas while retaining responsive gutters', () => {
  const html = read('public/about.html');
  const css = read('public/landing-assets/public-experience.css');
  assert.match(html, /<body class="about-page">/);
  assert.match(css, /\.about-page \.wrap\s*\{[^}]*width:\s*min\(1520px,\s*calc\(100%\s*-\s*64px\)\)/);
  assert.match(css, /@media \(max-width: 760px\)\s*\{[\s\S]*?\.about-page \.wrap\s*\{\s*width:\s*calc\(100%\s*-\s*32px\)/);
});

test('About page introductory and section descriptions are separated into compact visual panels', () => {
  const css = read('public/landing-assets/public-experience.css');
  assert.match(css, /\.about-page \.hero-copy\s*\{[^}]*border:\s*1px solid/);
  assert.match(css, /\.about-page \.hero-points span\s*\{[^}]*background:\s*#f8fbf9/);
  assert.match(css, /\.about-page \.section-head p\s*\{[^}]*border:\s*1px solid/);
});
