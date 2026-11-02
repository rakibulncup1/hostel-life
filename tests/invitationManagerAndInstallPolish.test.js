import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/Run29_invitation_link_rotation.sql');
const manager = read('src/features/manager/ManagerPages.jsx');
const service = read('src/services/hostelInviteService.js');
const menu = read('src/components/MenuDrawer.jsx');
const app = read('src/app/App.jsx');
const shell = read('src/app/AppShell.jsx');
const appDownload = read('src/features/menu/AppDownloadPage.jsx');
const appDownloadCss = read('src/styles/app-download.css');
const uiCss = read('src/styles/ui-refresh.css');

function getFunctionSql(name) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.notEqual(start, -1, `Missing Run29 function ${name}`);
  const end = migration.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `Missing function terminator ${name}`);
  return migration.slice(start, end + 4);
}

test('ManagerPages explicitly imports all Invitation RPC wrappers used by Settings and Join Request review', () => {
  const importBlock = manager.match(/import \{[\s\S]*?managerCreateHostelInviteLink[\s\S]*?\} from '\.\.\/\.\.\/services\/hostelInviteService';/);
  assert.ok(importBlock, 'Invitation service imports must exist at module scope');
  for (const name of [
    'managerCreateHostelInviteLink',
    'managerListHostelInviteLinks',
    'managerRevokeHostelInviteLink',
    'managerListHostelJoinRequests',
    'managerReviewHostelJoinRequest',
  ]) assert.match(importBlock[0], new RegExp(`\\b${name}\\b`));
});

test('Invitation creation sends a concrete seven-day expiry and a named label', () => {
  assert.match(service, /export async function managerCreateHostelInviteLink\(label = ''\)/);
  assert.match(service, /manager_create_or_rotate_hostel_invite_link/);
  assert.match(service, /p_label: label\.trim\(\)/);
  assert.doesNotMatch(service, /Date\.now|p_expires_at/);
  assert.match(manager, /managerCreateHostelInviteLink\('সদস্য আমন্ত্রণ'\)/);
  assert.match(manager, /result\?\.token[\s\S]*?\/\^\[0-9a-f\]\{64\}\$\//);
});

test('Run29 atomically revokes old invitations when a new one is created', () => {
  assert.match(migration, /^BEGIN;/m);
  assert.match(migration, /SET LOCAL lock_timeout = '8s'/);
  assert.match(migration, /SET LOCAL statement_timeout = '60s'/);
  const create = getFunctionSql('manager_create_hostel_invite_link');
  assert.match(create, /private\.assert_signed_in\(\)/);
  assert.match(create, /private\.assert_hostel_manager\(v_hostel, NULL, false, false\)/);
  assert.match(create, /UPDATE public\.hostel_access_links[\s\S]*?revoked_at = coalesce\(revoked_at, now\(\)\)[\s\S]*?revoked_at IS NULL/);
  assert.match(create, /INSERT INTO public\.hostel_access_links/);
  assert.ok(create.indexOf('UPDATE public.hostel_access_links') < create.indexOf('INSERT INTO public.hostel_access_links'));
  assert.match(create, /extensions\.gen_random_bytes\(32\)/);
  assert.match(create, /extensions\.digest\(v_token, 'sha256'\)/);
  assert.match(create, /'previous_links_revoked', v_revoked_count/);
  const stableCreate = getFunctionSql('manager_create_or_rotate_hostel_invite_link');
  assert.match(stableCreate, /now\(\) \+ interval '7 days'/);
  assert.match(stableCreate, /manager_create_hostel_invite_link/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.manager_create_hostel_invite_link\(timestamptz, text\) TO authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.manager_create_or_rotate_hostel_invite_link\(text\) TO authenticated/);
  assert.match(migration, /NOTIFY pgrst, 'reload schema'/);
  assert.match(migration, /COMMIT;\s*$/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE/i);
});

test('Primary and assistant managers can access one dedicated Join Request review page', () => {
  const primary = menu.slice(menu.indexOf('const primaryItems'), menu.indexOf('const assistantItems'));
  const assistant = menu.slice(menu.indexOf('const assistantItems'), menu.indexOf('export function MenuDrawer'));
  assert.match(primary, /key: 'join-requests', label: 'জয়েন রিকোয়েস্ট পর্যালোচনা'/);
  assert.match(assistant, /key: 'join-requests', label: 'জয়েন রিকোয়েস্ট পর্যালোচনা'/);
  assert.match(app, /\/app\/menu\/join-requests'[\s\S]*?<JoinRequestReviewPage \/>/);
  assert.match(shell, /'join-requests': '\/app\/menu\/join-requests'/);
  assert.match(manager, /export function JoinRequestReviewPage\(\)/);
  assert.match(manager, /<PageHeader title="জয়েন রিকোয়েস্ট পর্যালোচনা"/);
  assert.match(manager, /managerListHostelJoinRequests\(\)/);
  assert.match(manager, /managerReviewHostelJoinRequest\(row\.id, approve, reviewNote\)/);
  assert.match(manager, /function ManagerGuard\([\s\S]*?isOperationalManager/);
  const memberManagement = manager.slice(manager.indexOf('export function MemberManagementPage()'));
  assert.doesNotMatch(memberManagement, /<JoinRequestQueue\s*\/>/);
});

test('Assistant invitation controls stay inside ManagerGuard-protected Hostel Settings', () => {
  const settings = manager.slice(manager.indexOf('export function HostelSettingsPage()'), manager.indexOf('function JoinRequestQueue()'));
  assert.match(settings, /return \([\s\S]*?<ManagerGuard>/);
  assert.match(settings, /managerCreateHostelInviteLink/);
  assert.match(settings, /managerListHostelInviteLinks/);
  assert.match(settings, /managerRevokeHostelInviteLink/);
  assert.match(settings, /আগের সক্রিয় Invitation সঙ্গে সঙ্গে বাতিল হবে/);
});

test('App Install page is reduced to a single direct PWA action without download guides', () => {
  assert.match(appDownload, /useInstallPromptContext/);
  assert.match(appDownload, /canInstall \? \(/);
  assert.match(appDownload, /installNow/);
  assert.match(appDownload, /এখনই ইনস্টল করুন/);
  assert.match(appDownload, /installed \? 'Hostel Life ইনস্টল করা আছে'/);
  assert.doesNotMatch(appDownload, /INSTALL GUIDE|app-download-steps|Android · Chrome|iPhone \/ iPad|Desktop · Chrome/);
  assert.match(appDownloadCss, /\.app-download-single-card/);
  assert.doesNotMatch(appDownloadCss, /\.app-download-steps|\.app-download-step/);
  assert.match(appDownloadCss, /max-width:560px|@media \(max-width: 640px\)/);
});

test('Invitation and Join Request presentation has responsive manager styling', () => {
  assert.match(uiCss, /\.manager-invite-card/);
  assert.match(uiCss, /\.manager-join-request-list/);
  assert.match(uiCss, /\.manager-join-request-actions/);
  assert.match(uiCss, /@media\(max-width:560px\)/);
});
