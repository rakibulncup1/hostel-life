import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const auth = read('src/features/auth/AuthPage.jsx');
const menu = read('src/features/menu/MenuPages.jsx');
const manager = read('src/features/manager/ManagerPages.jsx');
const dashboard = read('src/features/dashboard/DashboardPage.jsx');
const dining = read('src/features/dining/DiningPage.jsx');
const report = read('src/services/reportService.js');
const shell = read('src/app/AppShell.jsx');
const app = read('src/app/App.jsx');
const invite = read('src/features/invites/HostelInvitePage.jsx');
const index = read('index.html');
const about = read('public/about.html');
const controls = read('public/landing-assets/public-controls.js');
const install = read('public/landing-assets/public-install.js');
const css = read('src/styles/run105-requested-ui-polish.css');
const main = read('src/main.jsx');

test('Login recovery action stays at right while account prompt and registration stay grouped at left', () => {
  assert.match(auth, /auth-switch-login/);
  assert.match(auth, /<span className=\"auth-register-group\">[\s\S]*auth-switch-account-prompt[\s\S]*auth-register-inline/);
  assert.match(auth, /auth-register-group[\s\S]*auth-forgot-inline/);
  assert.match(css, /auth-register-group[\s\S]*display:\s*inline-flex/);
  assert.match(css, /\.auth-forgot-inline[\s\S]*color:\s*#a54a4a/);
});

test('All-member cards open from the card surface and remain keyboard operable', () => {
  assert.match(menu, /className=\{`card all-member-card/);
  assert.match(menu, /role="button"[\s\S]*?tabIndex=\{0\}[\s\S]*?onClick=\{\(\) => openMemberDetails\(member\.membership_id\)\}/);
  assert.match(menu, /event\.key === 'Enter' \|\| event\.key === ' '/);
  assert.match(menu, /<span className="member-name-detail-trigger">/);
});

test('Member detail PDF uses the shared branded report and identifies its member', () => {
  assert.match(dashboard, /member-detail-pdf-button/);
  assert.match(dashboard, /\['সদস্যের নাম',\s*detail\.member\?\.name \|\| memberName/);
  assert.match(dashboard, /printReport\('সদস্যভিত্তিক বিস্তারিত'/);
  assert.match(dashboard, /class=\"report-summary report-member-summary\"[\s\S]*pageOrientation:\s*'portrait'[\s\S]*reportVariant:\s*'member-detail'/);
  assert.doesNotMatch(dashboard, /singlePage:\s*true/);
  assert.match(report, /@top-left\{content:\$\{pageBrandImage \?/);
  assert.match(report, /@top-right\{content:\$\{pageMetaImage \?/);
  assert.match(report, /@bottom-center\{content:\$\{pageFooter\}/);
});

test('Print reports reserve repeated branded header and footer space on every printed page', () => {
  assert.match(report, /@page\{size:\$\{pageSize\};margin:25\.4mm 12\.7mm 25\.4mm/);
  assert.match(report, /@top-left\{content:\$\{pageBrandImage \?/);
  assert.match(report, /@top-right\{content:\$\{pageMetaImage \?/);
  assert.match(report, /@bottom-center\{content:\$\{pageFooter\}/);
  assert.doesNotMatch(report, /top:-29mm|bottom:-18mm|position:fixed[^}]*report-(?:header|footer)/);
});

test('Dining subpages keep a previous-view history for their back controls', () => {
  assert.match(dining, /const \[viewHistory, setViewHistory\] = useState\(\[\]\)/);
  assert.match(dining, /if \(view !== nextView\) setViewHistory/);
  assert.match(dining, /const backToPrevious = \(\) =>/);
  assert.match(dining, /onClick=\{backToPrevious\}/);
});

test('Join request review removes decision-note entry while preserving approval/rejection action', () => {
  assert.doesNotMatch(manager, /value=\{reviewNote\}|সিদ্ধান্তের নোট|manager-request-note-row/);
  assert.match(manager, /const reviewNote = '';/);
  assert.match(manager, /managerReviewHostelJoinRequest\(row\.id, approve, reviewNote\)/);
  assert.match(manager, /অনুমোদন/);
  assert.match(manager, /বাতিল/);
});

test('Top shopper secondary heading is no longer a duplicate', () => {
  assert.match(menu, /টাকার পরিমাণ অনুযায়ী/);
});

test('Invite route forces light appearance before first paint and after React route changes', () => {
  assert.match(index, /path === '\/invite'[\s\S]*data-invite-page'[\s\S]*data-theme', 'light/);
  assert.match(app, /const isInviteRoute = pathname === '\/invite' \|\| pathname\.startsWith\('\/invite\/'\)/);
  assert.match(app, /if \(isInviteRoute\) applyTheme\('light'\)/);
  assert.match(app, /else if \(getThemePreference\(\) === 'system'\) applyTheme\('system'\)/);
  assert.match(css, /html\[data-invite-page\][\s\S]*\.hostel-invite-page/);
  assert.doesNotMatch(invite, /কোডের প্রয়োজন নেই/);
});

test('About download links navigate to the shared in-app install page without intercepting clicks', () => {
  assert.match(about, /href="\/app\/menu\/app-download"/);
  assert.match(install, /No click interception/);
  assert.doesNotMatch(install, /beforeinstallprompt|preventDefault\(\)/);
});

test('About theme menu closes on outside click and Escape', () => {
  assert.match(controls, /event\.target\.closest\('\.public-theme-control'\)/);
  assert.match(controls, /event\.key !== 'Escape'/);
  assert.match(controls, /removeAttribute\('open'\)/);
});

test('Update dialog renders published admin release notes inline and removes the detail-step dialog', () => {
  assert.match(shell, /release_notes_published === true/);
  assert.match(shell, /publishedReleaseNotes\.map/);
  assert.match(shell, /এখনই রিফ্রেশ করুন/);
  assert.match(shell, /পরে করব/);
  assert.doesNotMatch(shell, /releaseFeaturesOpen|বিস্তারিত দেখুন/);
  assert.match(css, /\.system-notice-close[\s\S]*border:\s*0 !important/);
});

test('System and admin notice dialogs use clean borderless close controls', () => {
  assert.match(css, /\.platform-communication-close[\s\S]*?border:\s*0 !important/);
  assert.match(css, /\.system-notice-close[\s\S]*?border:\s*0 !important/);
});

test('Run105 presentation overrides load after the previous auth stylesheet', () => {
  const run103 = main.indexOf("import './styles/run103-about-login-precision.css'");
  const run105 = main.indexOf("import './styles/run105-requested-ui-polish.css'");
  assert.ok(run103 >= 0 && run105 > run103);
});
