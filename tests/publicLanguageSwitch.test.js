import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const publicPages = ['public/about.html', 'public/privacy-policy.html', 'public/terms-of-service.html'];

test('public documents remain Bengali-first and expose no language switch or dormant language script', () => {
  for (const file of publicPages) {
    const html = read(file);
    assert.match(html, /<html lang="bn-BD">/);
    assert.doesNotMatch(html, /language-toggle|public-language\.js/);
  }
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
