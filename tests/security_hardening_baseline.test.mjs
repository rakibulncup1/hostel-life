import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const sha256 = (value) => createHash('sha256').update(value).digest('base64');

test('Vercel applies baseline security headers to all routes', async () => {
  const config = await readJson('../vercel.json');
  const rule = config.headers.find((entry) => entry.source === '/(.*)');
  assert.ok(rule, 'global /(.*) response-header rule is required');
  const values = Object.fromEntries(rule.headers.map(({ key, value }) => [key.toLowerCase(), value]));
  assert.equal(values['strict-transport-security'], 'max-age=31536000');
  assert.equal(values['x-content-type-options'], 'nosniff');
  assert.equal(values['x-frame-options'], 'DENY');
  assert.equal(values['referrer-policy'], 'no-referrer');
  assert.ok(values['permissions-policy'].includes('camera=()'));
  assert.ok(values['permissions-policy'].includes('microphone=()'));
  assert.ok(values['permissions-policy'].includes('geolocation=()'));
  assert.ok(values['content-security-policy-report-only'], 'CSP rollout must begin in Report-Only mode');
});

test('Report-Only CSP permits only known inline script hashes and no eval/inline-script wildcard', async () => {
  const config = await readJson('../vercel.json');
  const rule = config.headers.find((entry) => entry.source === '/(.*)');
  const csp = rule.headers.find((entry) => entry.key.toLowerCase() === 'content-security-policy-report-only')?.value || '';
  assert.ok(csp.includes("default-src 'self'"));
  assert.ok(csp.includes("object-src 'none'"));
  assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.ok(!csp.includes("'unsafe-eval'"));
  assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp));

  const htmlFiles = ['../index.html', '../public/about.html', '../public/privacy-policy.html', '../public/terms-of-service.html'];
  for (const file of htmlFiles) {
    const html = await readFile(new URL(file, import.meta.url), 'utf8');
    const scripts = html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi);
    for (const match of scripts) {
      if (/type=["']application\/ld\+json["']/i.test(match[1])) continue;
      const body = match[2];
      if (!body.trim()) continue;
      const hash = `sha256-${sha256(body)}`;
      assert.ok(csp.includes(`'${hash}'`), `Missing CSP hash for inline script in ${file}: ${hash}`);
    }
  }

  const reportService = await readFile(new URL('../src/services/reportService.js', import.meta.url), 'utf8');
  const popupScript = reportService.match(/<script>(window\.onload=[\s\S]*?)<\\\/script>/);
  assert.ok(popupScript, 'PDF popup print script marker must exist');
  assert.ok(csp.includes(`'sha256-${sha256(popupScript[1])}'`), 'PDF popup script hash must be allow-listed');
});

test('Vite dev and preview servers bind only to loopback', async () => {
  const config = await readFile(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.match(config, /server:\s*\{[\s\S]*?host:\s*['"]127\.0\.0\.1['"]/);
  assert.match(config, /preview:\s*\{[\s\S]*?host:\s*['"]127\.0\.0\.1['"]/);
  assert.doesNotMatch(config, /host:\s*true/);
});

test('Dependabot and scheduled npm audit are configured for both package ecosystems', async () => {
  const yaml = await readFile(new URL('../.github/dependabot.yml', import.meta.url), 'utf8');
  assert.match(yaml, /package-ecosystem:\s*npm/);
  assert.match(yaml, /package-ecosystem:\s*github-actions/);
  assert.match(yaml, /interval:\s*weekly/);

  const workflow = await readFile(new URL('../.github/workflows/dependency-security-audit.yml', import.meta.url), 'utf8');
  assert.match(workflow, /npm run security:check/);
  assert.match(workflow, /npm audit --audit-level=high/);
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /permissions:[\s\S]*contents:\s*read/);
});

test('Vite minimum-version guard is wired to the project security script', async () => {
  const pkg = await readJson('../package.json');
  assert.equal(pkg.scripts['security:check'], 'node scripts/check-vite-security-version.mjs');
  const checker = await readFile(new URL('../scripts/check-vite-security-version.mjs', import.meta.url), 'utf8');
  assert.match(checker, /minor === 4 && patch >= 6/);
  assert.ok(checker.includes('npm install --save-dev vite@^6.4.6'));
});

test('Supabase local linkage metadata is ignored going forward', async () => {
  const ignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.match(ignore, /^supabase\/\.temp\//m);
});

test('no raw HTML injection sink is introduced in React source', async () => {
  const walk = async (dir) => {
    const entries = await readdir(new URL(`../${dir}`, import.meta.url), { withFileTypes: true });
    const output = [];
    for (const entry of entries) {
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) output.push(...await walk(relative));
      else if (/\.(?:jsx?|tsx?)$/.test(entry.name)) output.push(relative);
    }
    return output;
  };
  const files = await walk('src');
  const matches = [];
  for (const file of files) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    if (/dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML\s*\(/.test(source)) matches.push(file);
  }
  assert.deepEqual(matches, [], `Unexpected raw HTML injection surfaces: ${matches.join(', ')}`);
});
