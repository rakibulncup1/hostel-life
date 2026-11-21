import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const reportService = read('src/services/reportService.js');
const dashboard = read('src/features/dashboard/DashboardPage.jsx');
const menu = read('src/features/menu/MenuPages.jsx');
const manager = read('src/features/manager/ManagerPages.jsx');
const styles = read('src/styles/run105-requested-ui-polish.css');

test('all PDF exports share reserved repeating page header and footer areas', () => {
  assert.match(reportService, /@page\{size:\$\{pageSize\};margin:25\.4mm 12\.7mm 25\.4mm;/);
  assert.match(reportService, /@top-left\{content:\$\{pageBrandImage \?/);
  assert.match(reportService, /@top-right\{content:\$\{pageMetaImage \?/);
  assert.match(reportService, /@bottom-center\{content:\$\{pageFooter\}/);
  assert.match(reportService, /thead\{display:table-header-group\}/);
  assert.match(reportService, /tr\{break-inside:avoid;page-break-inside:avoid\}/);
  assert.doesNotMatch(reportService, /top:-29mm|bottom:-18mm|position:fixed[^}]*report-(?:header|footer)/);
  assert.match(reportService, /function cssContentString\(value\)/);
  assert.match(reportService, /Designed & Developed by Rakibul Islam Samrat/);
  assert.match(reportService, /export function printArchivedMonthlyReport/);
  assert.match(reportService, /periodLabel: detail\.label/);
});

test('dashboard member PDF uses the same global report print service and member-detail layout', () => {
  assert.match(dashboard, /printReport\('সদস্যভিত্তিক বিস্তারিত'/);
  assert.match(dashboard, /reportVariant: 'member-detail'/);
  assert.match(dashboard, /pageOrientation: 'portrait'/);
  assert.match(dashboard, /report-member-summary/);
  assert.match(dashboard, /report-member-table/);
});

test('All Members reuses the dashboard member detail modal and its scoped presentation', () => {
  assert.match(menu, /import \{ MemberPeriodDetailsModal \} from '\.\.\/dashboard\/DashboardPage'/);
  assert.match(menu, /<MemberPeriodDetailsModal[\s\S]*?styleScopeClass="dashboard-reimagined"/);
  assert.match(menu, /onClose=\{\(\) => \{ setSelectedMemberId\(''\); setMemberDetail\(null\); \}\}/);
  assert.match(dashboard, /styleScopeClass = ''/);
  assert.match(dashboard, /modal-backdrop \$\{styleScopeClass\}/);
});

test('login footer centers account registration and recovery on separate rows', () => {
  assert.match(styles, /\.auth-page \.auth-switch-login\s*\{[^}]*display:\s*grid\s*!important/s);
  assert.match(styles, /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(styles, /\.auth-page \.auth-switch-login \.auth-register-group\s*\{[^}]*justify-content:\s*center/s);
  assert.match(styles, /\.auth-page \.auth-switch-login \.auth-forgot-inline\s*\{[^}]*justify-self:\s*center/s);
});

test('Help FAQ disclosures constrain long questions and answers to viewport width', () => {
  assert.match(styles, /\.howto-page \.howto-faq-groups,[\s\S]*?\.howto-page \.howto-faq-answer\s*\{[^}]*width:\s*100%/);
  assert.match(styles, /\.howto-page \.howto-faq-item > summary\s*\{[^}]*minmax\(0, 1fr\)/s);
  assert.match(styles, /\.howto-page \.howto-faq-question\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(styles, /\.howto-page \.howto-faq-answer > p\s*\{[^}]*max-width:\s*100%/s);
});

test('Khala payment history keeps amount, status and authorized actions inside one card', () => {
  assert.match(manager, /khala-entry-card-main/);
  assert.match(manager, /khala-entry-card-amount/);
  assert.match(manager, /khala-entry-card-footer/);
  assert.match(manager, /onClick=\{\(\) => startEdit\(row\)\}/);
  assert.match(manager, /onClick=\{\(\) => \{ setVoidTarget\(row\); setVoidReason\(''\); \}\}/);
  assert.match(manager, /selectedPeriod\?\.can_manage_khala && row\.status !== 'void'/);
  assert.match(styles, /\.khala-manager-ledger-row \.khala-entry-card-footer\s*\{[^}]*width:\s*100%/s);
  assert.match(styles, /\.khala-manager-ledger-row \.khala-entry-card-amount\s*\{[^}]*min-width:\s*108px/s);
});

test('Run107 changes remain focused on requested UI and report files', () => {
  assert.equal((reportService.match(/export function printReport\(/g) || []).length, 1);
  assert.doesNotMatch(menu, /supabase\.rpc\(/);
  assert.doesNotMatch(manager.slice(manager.indexOf('export function KhalaMoneyPage'), manager.indexOf('export function ArchiveManagerPage')), /\.rpc\(/);
});
