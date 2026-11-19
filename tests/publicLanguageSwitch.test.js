import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const publicPages = ['public/about.html', 'public/privacy-policy.html', 'public/terms-of-service.html'];

test('About owns the public language switch; legal pages inherit the saved preference', () => {
  for (const file of publicPages) {
    const html = read(file);
    assert.match(html, /<html lang="bn-BD">/);
    assert.match(html, /app-english-translations\.js/);
    assert.match(html, /language-runtime\.js/);
    assert.ok(html.indexOf('app-english-translations.js') < html.indexOf('language-runtime.js'), `${file} must load translations before runtime`);
  }
  const about = read('public/about.html');
  assert.equal((about.match(/data-language-switch/g) || []).length, 1, 'About should expose one responsive language switch');
  assert.equal((read('public/privacy-policy.html').match(/data-language-switch/g) || []).length, 0);
  assert.equal((read('public/terms-of-service.html').match(/data-language-switch/g) || []).length, 0);
  assert.match(about, /data-theme-choice="dark"/);
  assert.doesNotMatch(read('public/privacy-policy.html'), /data-theme-choice=/);
  assert.doesNotMatch(read('public/terms-of-service.html'), /data-theme-choice=/);

  assert.equal(fs.existsSync(path.join(root, 'public/landing-assets/public-language.js')), false);
});

test('public documents retain their legal links and shared public visual system', () => {
  for (const file of publicPages) {
    const html = read(file);
    assert.match(html, /public-experience\.css/);
    assert.match(html, /href="\/auth\/login"/);
    assert.match(html, /href="\/auth\/register"/);
  }
});
