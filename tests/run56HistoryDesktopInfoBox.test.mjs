import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/features/history/history-page-visual-refinement.css', import.meta.url), 'utf8');

 test('History desktop guidance box uses a compact theme-matched layout', () => {
  assert.match(css, /@media\s*\(min-width:\s*641px\)[\s\S]*?\.page-stack \.history-title-row \.history-intro-guidance-box\s*\{[\s\S]*?width:\s*100%[\s\S]*?min-height:\s*0[\s\S]*?padding:\s*9px 14px/);
  assert.match(css, /background:\s*color-mix\(in srgb, var\(--primary-soft\)\s+48%,\s*var\(--surface\)\)/);
});

test('History desktop guidance text is normal weight and does not inherit heavy emphasis', () => {
  const desktopRule = css.match(/@media\s*\(min-width:\s*641px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(desktopRule, /font-weight:\s*400/);
  assert.match(desktopRule, /\.history-intro-guidance-box\s*>\s*span[\s\S]*?font-weight:\s*400/);
  assert.match(desktopRule, /color:\s*var\(--muted\)/);
});

test('History mobile guidance layout remains controlled by the existing mobile rules', () => {
  assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*?\.page-stack \.history-title-row \.history-intro-guidance-box[\s\S]*?padding:\s*12px 14px/);
  assert.match(css, /@media\s*\(min-width:\s*641px\)/);
});
