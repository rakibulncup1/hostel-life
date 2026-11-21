import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const aboutCss = read('public/landing-assets/run102-about-interaction.css');
const auth = read('src/features/auth/AuthPage.jsx');
const authCss = read('src/styles/run105-requested-ui-polish.css');
const dashboard = read('src/features/dashboard/DashboardPage.jsx');
const reports = read('src/services/reportService.js');

test('About language action uses a compact polished control without the awkward faux slider', () => {
  assert.match(aboutCss, /Run106 — refined public About language action/);
  assert.match(aboutCss, /min-width:\s*80px/);
  assert.match(aboutCss, /border-radius:\s*10px/);
  assert.match(aboutCss, /content:\s*"文A"/);
  assert.match(aboutCss, /:root\[data-theme="dark"\][\s\S]*public-language-switcher/);
  assert.doesNotMatch(aboutCss.slice(aboutCss.indexOf('Run106 — refined public About language action')), /position:\s*absolute;[\s\S]{0,180}border-radius:\s*50%/);
});

test('Login footer structure groups the account prompt with registration before the recovery action', () => {
  const groupStart = auth.indexOf('<span className="auth-register-group">');
  const forgotStart = auth.indexOf('className="text-button auth-forgot-inline"', groupStart);
  assert.ok(groupStart >= 0 && forgotStart > groupStart);
  assert.ok(auth.indexOf('auth-switch-account-prompt', groupStart) < auth.indexOf('auth-register-inline', groupStart));
  assert.match(authCss, /auth-switch-login[\s\S]*justify-content:\s*space-between\s*!important/);
  assert.match(authCss, /auth-register-group[\s\S]*display:\s*inline-flex/);
});

test('Member PDF uses normal multi-page branded reports rather than compressed single-page mode', () => {
  assert.match(dashboard, /report-member-summary/);
  assert.match(dashboard, /<col style="width:19%"><col style="width:31%"><col style="width:19%"><col style="width:31%">/);
  assert.match(dashboard, /report-member-section/);
  assert.match(dashboard, /report-member-table/);
  assert.match(dashboard, /pageOrientation:\s*'portrait'/);
  assert.match(dashboard, /reportVariant:\s*'member-detail'/);
  assert.doesNotMatch(dashboard, /singlePage:\s*true/);
});

test('Member detail report adds scoped summary/table layout and keeps repeated branded page furniture', () => {
  assert.match(reports, /metadata\.reportVariant === 'member-detail'/);
  assert.match(reports, /report-member-detail \.report-member-summary/);
  assert.match(reports, /report-member-detail \.report-member-table thead\{display:table-header-group\}/);
  assert.match(reports, /@page\{size:\$\{pageSize\};margin:25\.4mm 12\.7mm 25\.4mm/);
  assert.match(reports, /@top-left\{content:\$\{pageBrandImage \?/);
  assert.match(reports, /@top-right\{content:\$\{pageMetaImage \?/);
  assert.match(reports, /@bottom-center\{content:\$\{pageFooter\}/);
  assert.doesNotMatch(reports, /top:-29mm|bottom:-18mm|position:fixed[^}]*report-(?:header|footer)/);
  assert.match(reports, /Copyright ©/);
});
