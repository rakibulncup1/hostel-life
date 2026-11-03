import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src', import.meta.url));
const iconSource = readFileSync(join(root, 'components/Icon.jsx'), 'utf8');
const registeredIcons = new Set(
  [...iconSource.matchAll(/^\s*(?:'([^']+)'|([A-Za-z_$][\w$]*))\s*:/gm)]
    .map((match) => match[1] || match[2]),
);

function collectSourceFiles(directory) {
  const results = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) results.push(...collectSourceFiles(path));
    else if (/\.(?:jsx?|tsx?)$/.test(name)) results.push(path);
  }
  return results;
}

test('every statically rendered Icon in the application has a registered SVG path', () => {
  const unknown = [];
  for (const path of collectSourceFiles(root)) {
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(/<Icon\s+name=["']([^"']+)["']/g)) {
      if (!registeredIcons.has(match[1])) unknown.push(`${relative(root, path)}: ${match[1]}`);
    }
  }
  assert.deepEqual(unknown, [], `Unregistered Icon names: ${unknown.join(', ')}`);
});


test('icons selected dynamically by UI state are registered', () => {
  const dynamicNames = [
    'wrench', 'droplet', 'loader-circle', 'user-x', 'check-circle-2', 'circle',
    'monitor', 'sun', 'moon', 'camera', 'shield', 'bell', 'check', 'warning', 'offline',
  ];
  const unknown = dynamicNames.filter((name) => !registeredIcons.has(name));
  assert.deepEqual(unknown, [], `Unregistered dynamic Icon names: ${unknown.join(', ')}`);
});
