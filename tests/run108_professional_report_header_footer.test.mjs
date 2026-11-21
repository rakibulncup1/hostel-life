import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const reports = read('src/services/reportService.js');
const dashboard = read('src/features/dashboard/DashboardPage.jsx');
const menu = read('src/features/menu/MenuPages.jsx');
const history = read('src/features/history/HistoryPage.jsx');
const manager = read('src/features/manager/ManagerPages.jsx');
const archive = read('src/features/archive/ArchiveCorrectionPage.jsx');

test('global A4 report template reserves half-inch top/side margins, a one-inch header, a half-inch post-header gap and a one-inch footer', () => {
  assert.match(reports, /@page\{size:\$\{pageSize\};margin:50\.8mm 12\.7mm 38\.1mm;/);
  assert.match(reports, /@top-center\{content:\$\{headerContent\};vertical-align:top;padding-top:12\.7mm;/);
  assert.doesNotMatch(reports, /background-image:url/);
  assert.match(reports, /@bottom-center\{content:\$\{pageFooter\}[^}]*width:calc\(100% - 25\.4mm\);height:25\.4mm;margin:0 auto/);
  assert.match(reports, /context\.strokeStyle = '#d8e3db'/);
  assert.match(reports, /border-top:\.8pt solid #dfe7e1/);
});

test('left report heading uses project logo and a high-resolution canvas hierarchy', () => {
  assert.match(reports, /new URL\('\/icons\/hostel-life-mark\.svg', window\.location\.origin\)/);
  assert.match(reports, /buildReportHeaderImage\(/);
  assert.match(reports, /appName: 'Hostel Life'/);
  assert.match(reports, /tagline: isEnglish \? 'Simple, transparent and organised management\.' : 'সহজ, স্বচ্ছ ও সুশৃঙ্খল ব্যবস্থাপনা'/);
  assert.match(reports, /reportTitle: reportHeading/);
  assert.match(reports, /dateRange: periodDateRange/);
  assert.match(reports, /REPORT_HEADER_DPI = 96/);
  assert.match(reports, /REPORT_HEADER_PIXELS_PER_MM = REPORT_HEADER_DPI \/ 25\.4/);
  assert.match(reports, /fitReportCanvasText\(context, appName, \{\s*weight: 800/);
});

test('right header includes month, same-line manager/contact, report creator and timestamp', () => {
  assert.match(reports, /const generatedBy = String\(metadata\.generatedBy \|\| metadata\.preparedBy \|\| metadata\.reportCreator/);
  assert.match(reports, /rightRows = \[/);
  assert.match(reports, /labels\.manager}: \$\{managerName/);
  assert.match(reports, /labels\.contact}: \$\{managerPhone/);
  assert.match(reports, /labels\.month}: \$\{periodLabel/);
  assert.match(reports, /labels\.preparedBy}: \$\{generatedBy/);
  assert.match(reports, /labels\.generatedAt}: \$\{generatedAt/);
});

test('every report entry point passes the report creator, manager and period metadata where available', () => {
  assert.match(dashboard, /managerName,\s*managerPhone,\s*generatedBy: membership\?\.member_name/);
  assert.match(dashboard, /periodStart: detail\.period\?\.start_date/);
  assert.match(menu, /import \{ MemberPeriodDetailsModal \} from '\.\.\/dashboard\/DashboardPage'/);
  assert.match(history, /generatedBy: membership\?\.member_name \|\| profile\?\.full_name/);
  assert.match(history, /periodStart: selectedReportPeriod\?\.start_date/);
  assert.match(history, /printArchivedMonthlyReport\(detail, reportWindow, \{ generatedBy:/);
  assert.match(manager, /periodStart: bundle\.period\.start_date/);
  assert.match(manager, /generatedBy: membership\?\.member_name \|\| profile\?\.full_name/);
  assert.match(archive, /printArchivedMonthlyReport\(detail, null, \{ generatedBy:/);
});

test('footer preserves the two copyright/branding lines and shortens its divider by one inch', () => {
  assert.match(reports, /Copyright © \$\{currentYear\} Hostel-Life\. All rights reserved\./);
  assert.match(reports, /Designed & Developed by Rakibul Islam Samrat/);
  assert.match(reports, /width:calc\(100% - 25\.4mm\);height:25\.4mm;margin:0 auto;padding:1\.2mm 0 0/);
});

test('all report pages use normal content flow; no fixed header/footer offsets remain', () => {
  assert.match(reports, /<main class="report-body">\$\{subtitleMarkup\}\$\{reportMarkup\}<\/main>/);
  assert.doesNotMatch(reports, /top:-29mm|bottom:-18mm|position:fixed[^}]*report-(?:header|footer)/);
  assert.match(reports, /thead\{display:table-header-group\}/);
  assert.match(reports, /tr\{break-inside:avoid;page-break-inside:avoid\}/);
});
