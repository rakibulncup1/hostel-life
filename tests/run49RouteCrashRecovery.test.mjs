import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (file) => fs.readFileSync(path.resolve(file), 'utf8');

test('Dining permission state is initialized before its useEffect dependency list is evaluated', () => {
  const source = read('src/features/dining/DiningPage.jsx');
  const declaration = source.indexOf('const managerAuthorizationPending =');
  const effect = source.indexOf('useEffect(() => {\n    if (loadingMembers || managerAuthorizationPending)');
  assert.ok(declaration >= 0, 'managerAuthorizationPending declaration must exist');
  assert.ok(effect > declaration, 'the hook must not read a later const in its dependency array');
  assert.match(source.slice(effect, effect + 500), /\[view, loadingMembers, managerAuthorizationPending, canOperateDining, canManageFinalMeals\]/);
});

test('the entire React application is protected by the render error boundary', () => {
  const main = read('src/main.jsx');
  assert.match(main, /import \{ AppRouteErrorBoundary \} from '\.\/components\/AppRouteErrorBoundary';/);
  assert.match(main, /<AppRouteErrorBoundary onReturnToDashboard=/);
  assert.match(main, /<AppWithInstallPrompt \/>[\s\S]*?<\/AppRouteErrorBoundary>/);
});

test('route error boundary offers recovery and does not persist error or user data', () => {
  const boundary = read('src/components/AppRouteErrorBoundary.jsx');
  assert.match(boundary, /static getDerivedStateFromError/);
  assert.match(boundary, /আবার চেষ্টা করুন/);
  assert.match(boundary, /ড্যাশবোর্ডে ফিরে যান/);
  assert.match(boundary, /console\.error/);
  assert.doesNotMatch(boundary, /localStorage|sessionStorage|supabase|fetch\(/);
});

test('every stylesheet imported by the application entry point exists', () => {
  const main = read('src/main.jsx');
  const imports = [...main.matchAll(/import\s+['"](\.\/styles\/[^'"]+\.css)['"]/g)].map((m) => m[1]);
  assert.ok(imports.length >= 10);
  for (const item of imports) assert.ok(fs.existsSync(path.resolve('src', item.replace(/^\.\//, ''))), `missing ${item}`);
});

test('local JavaScript/JSX imports resolve to an existing source file', () => {
  const files = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (/\.(jsx?|mjs)$/.test(ent.name)) files.push(full);
    }
  };
  walk('src');
  const extensions = ['', '.js', '.jsx', '.mjs', '.json', '.css', '/index.js', '/index.jsx'];
  const missing = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
      const base = path.resolve(path.dirname(file), match[1]);
      if (!extensions.some((ext) => fs.existsSync(base + ext))) missing.push(`${file}: ${match[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});
