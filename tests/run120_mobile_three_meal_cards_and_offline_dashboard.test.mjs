import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../src/styles/dining-experience-v2.css', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/app/App.jsx', import.meta.url), 'utf8');
const worker = await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8');

test('person-based final meal keeps breakfast, lunch and dinner in three mobile columns', () => {
  const run120 = css.slice(css.indexOf('Run120: keep all three meal controls'));
  assert.match(run120, /\.manager-meal-grid\.member-final-day-meals[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(run120, /\.member-final-day-meals \.meal-stepper-row[\s\S]*?flex-direction:\s*column/);
  assert.match(run120, /\.member-final-day-meals \.meal-stepper-row\s*>\s*span[\s\S]*?white-space:\s*nowrap/);
  assert.match(run120, /\.member-final-day-meals \.meal-stepper[\s\S]*?grid-template-columns:\s*24px\s+minmax\(14px,\s*1fr\)\s+24px/);
});

test('offline active members are routed to dashboard from ordinary app/public routes', () => {
  assert.match(app, /navigator\.onLine\s*===\s*false[\s\S]*?auth\.isAuthenticated[\s\S]*?auth\.identityReady[\s\S]*?auth\.membership\?\.status\s*===\s*'active'[\s\S]*?navigateTo\('\/app\/dashboard',\s*true\)/);
  assert.match(app, /window\.addEventListener\('offline',\s*updateConnectivity\)/);
  assert.match(app, /window\.addEventListener\('online',\s*updateConnectivity\)/);
});

test('offline app-download entry redirects active members but remains public online', () => {
  assert.match(app, /if \(pathname === '\/app\/menu\/app-download'\)[\s\S]*?navigator\.onLine === false[\s\S]*?auth\.membership\?\.status === 'active'[\s\S]*?navigateTo\('\/app\/dashboard', true\)[\s\S]*?return;/);
});

test('service worker falls back to cached app shell for public URL navigation only when offline', () => {
  const publicBranch = worker.slice(worker.indexOf('const publicDocumentPaths'), worker.indexOf('event.respondWith(\n      networkFirst'));
  assert.match(publicBranch, /fetch\(request, \{ cache: 'no-store' \}\)/);
  assert.match(publicBranch, /response\.ok \|\| response\.status < 500/);
  assert.match(publicBranch, /caches\.match\('\/index\.html'\)/);
  assert.match(publicBranch, /return appShell \|\| response/);
});

test('invitation bearer URLs remain network-only and are not replaced with cached app shell', () => {
  const inviteIndex = worker.indexOf("url.pathname === '/invite'");
  const publicIndex = worker.indexOf('const publicDocumentPaths');
  assert.ok(inviteIndex >= 0 && publicIndex > inviteIndex);
  const inviteBranch = worker.slice(inviteIndex, publicIndex);
  assert.match(inviteBranch, /fetch\(request, \{ cache: 'no-store' \}\)/);
  assert.doesNotMatch(inviteBranch, /caches\.match/);
});
