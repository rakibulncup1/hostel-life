import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, '..');
const aboutPath = path.join(projectRoot, 'public', 'about.html');
const stylesheetPath = path.join(projectRoot, 'public', 'landing-assets', 'run81-about-dark-surface-system.css');

test('About page references the restored Run81 stylesheet at the exact public path', async () => {
  const html = await readFile(aboutPath, 'utf8');
  assert.match(html, /href=["']\/landing-assets\/run81-about-dark-surface-system\.css["']/i);
  await access(stylesheetPath);
});

test('restored stylesheet is non-empty and contains the intended dark About surface scope', async () => {
  const css = await readFile(stylesheetPath, 'utf8');
  assert.ok(css.trim().length > 1000, 'stylesheet content appears incomplete');
  assert.match(css, /:root\[data-theme=["']dark["']\]\s+\.about-page/);
});
