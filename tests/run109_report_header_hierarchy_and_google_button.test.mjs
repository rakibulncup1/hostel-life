import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const report = read('src/services/reportService.js');
const auth = read('src/features/auth/AuthPage.jsx');
const googleCss = read('src/styles/run105-requested-ui-polish.css');
const manager = read('src/features/manager/ManagerPages.jsx');
const dashboard = read('src/features/dashboard/DashboardPage.jsx');
const history = read('src/features/history/HistoryPage.jsx');

test('report header loads the exact project logo asset rather than a duplicated logo drawing', () => {
  assert.match(report, /new URL\('\/icons\/hostel-life-mark\.svg', window\.location\.origin\)/);
  assert.doesNotMatch(report, /REPORT_BRAND_MARK_DATA_URI/);
});

test('left header follows logo + larger app name + tagline + report name + date range hierarchy', () => {
  assert.match(report, /buildReportHeaderImage\(/);
  assert.match(report, /fitReportCanvasText\(context, appName, \{\s*weight: 800/);
  assert.match(report, /fitReportCanvasText\(context, tagline, \{\s*weight: 500/);
  assert.match(report, /fitReportCanvasText\(context, reportTitle/);
  assert.match(report, /fitReportCanvasText\(context, dateRange/);
  assert.match(report, /reportTitle: reportHeading/);
  assert.match(report, /dateRange: periodDateRange/);
});

test('manager name and phone share one meta line, followed by month, creator and generated time', () => {
  assert.match(report, /labels\.manager\}: \$\{managerName \|\| '—'\}/);
  assert.match(report, /labels\.contact\}: \$\{managerPhone \|\| '—'\}/);
  assert.match(report, /managerName \|\| '—'[\s\S]*managerPhone \|\| '—'/);
  assert.match(report, /labels\.month\}: \$\{periodLabel/);
  assert.match(report, /labels\.preparedBy\}: \$\{generatedBy/);
  assert.match(report, /labels\.generatedAt\}: \$\{generatedAt/);
});

test('report range uses period data and shows running instead of a not-yet-closed end date', () => {
  assert.match(report, /function formatReportHeaderDate\(value\)/);
  assert.match(report, /metadata\.periodStart \|\| metadata\.startDate/);
  assert.match(report, /metadata\.periodEnd \|\| metadata\.endDate/);
  assert.match(report, /metadata\.periodStatus \|\| metadata\.status/);
  assert.match(report, /\['running', 'open', 'active'\]\.includes\(periodStatus\) \|\| !periodEnd/);
  assert.match(report, /translateReportUi\('চলমান'\)/);
  assert.match(manager, /periodStart: bundle\.period\.start_date/);
  assert.match(manager, /periodEnd: bundle\.period\.end_date/);
  assert.match(history, /periodStart: selectedReportPeriod\?\.start_date/);
  assert.match(dashboard, /periodStart: detail\.period\?\.start_date/);
});

test('header line leaves breathing room and footer copyright sits slightly closer under its rule', () => {
  assert.match(report, /vertical-align:top;text-align:center;width:calc\(100% - 25\.4mm\);height:25\.4mm;margin:0 auto;padding:1\.2mm 0 0;border-top:\.8pt solid/);
});

test('official Google Identity Services button uses the supported filled blue theme', () => {
  assert.match(auth, /theme: 'filled_blue'/);
  assert.doesNotMatch(auth, /theme: 'outline'/);
  assert.match(googleCss, /linear-gradient\(135deg, #4285f4 0%, #2f6fda 58%, #2459b8 100%\)/);
  assert.match(googleCss, /color: #fff !important/);
  assert.match(googleCss, /\.auth-page \.google-signin-button:hover:not\(:disabled\)/);
});
