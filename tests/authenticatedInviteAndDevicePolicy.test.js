import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const migration = read('supabase/migrations/Run28_secure_authenticated_invites_and_device_policy.sql');
const onboarding = read('src/features/onboarding/OnboardingPage.jsx');
const manager = read('src/features/manager/ManagerPages.jsx');
const platform = read('src/features/platform/SuperAdminPage.jsx');
const app = read('src/app/App.jsx');
const helper = read('src/utils/pendingHostelLink.js');
const howTo = read('src/features/menu/MenuPages.jsx');
const appDownload = read('src/features/menu/AppDownloadPage.jsx');
const menu = read('src/components/MenuDrawer.jsx');
const authContext = read('src/contexts/AuthContext.jsx');
const authPage = read('src/features/auth/AuthPage.jsx');
const publicCss = read('src/styles/public-entry.css');
const downloadCss = read('src/styles/app-download.css');
const vercel = JSON.parse(read('vercel.json'));
const backupCore = read('tools/backup_assistant/core.py');

function functionSql(name, schema = 'public') {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION ${schema}.${name}`);
  assert.notEqual(start, -1, `Missing function ${schema}.${name}`);
  const next = migration.indexOf('\n$$;', start);
  assert.notEqual(next, -1, `Could not find end of ${schema}.${name}`);
  return migration.slice(start, next + 4);
}

function lastFunctionSql(name, schema = 'public') {
  const start = migration.lastIndexOf(`CREATE OR REPLACE FUNCTION ${schema}.${name}`);
  assert.notEqual(start, -1, `Missing final function ${schema}.${name}`);
  const next = migration.indexOf('\n$$;', start);
  assert.notEqual(next, -1, `Could not find end of final ${schema}.${name}`);
  return migration.slice(start, next + 4);
}

test('Run28 is transactional and stops before making changes if required Supabase schema is missing', () => {
  assert.match(migration, /\nBEGIN;/);
  assert.match(migration, /COMMIT;\s*$/);
  assert.match(migration, /SET LOCAL lock_timeout = '8s'/);
  assert.match(migration, /SET LOCAL statement_timeout = '120s'/);
  assert.match(migration, /required Run1–Run27 table is missing/);
  assert.match(migration, /required permission, Auth or cryptographic helper function is missing/);
  assert.match(migration, /auth\.sessions[\s\S]*?column_name='not_after'/);
});

test('Run28 creates authenticated invitations only; it never opens anonymous/public hostel data', () => {
  assert.doesNotMatch(migration, /public_view|get_public_hostel_snapshot|public-hostel/i);
  assert.doesNotMatch(app, /PublicHostelPage|public-hostel/);
  assert.ok(!vercel.rewrites.some((route) => route.source.startsWith('/public-hostel')));
  const anonGrants = migration.split(/\r?\n/).filter((line) => /^GRANT EXECUTE ON FUNCTION .* TO anon/.test(line.trim()));
  assert.deepEqual(anonGrants.map((line) => line.trim()), [
    'GRANT EXECUTE ON FUNCTION public.get_platform_public_settings() TO anon,authenticated;'
  ]);
  assert.match(migration, /REVOKE ALL ON TABLE public\.hostel_access_links FROM PUBLIC,anon,authenticated/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.hostel_join_requests FROM PUBLIC,anon,authenticated/);
  assert.doesNotMatch(howTo, /Secure Public Link দিয়ে কী দেখা যায়/);
});

test('Join Codes rotate legacy values and enforce exactly 12 uppercase hexadecimal characters', () => {
  assert.match(migration, /join_code IS NULL OR join_code !~ '\^\[0-9A-F\]\{12\}\$'/);
  assert.match(migration, /CHECK \(join_code ~ '\^\[0-9A-F\]\{12\}\$'\)/);
  assert.match(functionSql('generate_hostel_join_code', 'private'), /gen_random_bytes\(6\)/);
  assert.match(functionSql('create_hostel_secure'), /private\.generate_hostel_join_code\(\)/);
  assert.match(functionSql('regenerate_join_code'), /private\.generate_hostel_join_code\(\)/);
  assert.match(functionSql('regenerate_join_code'), /assert_hostel_manager\(v_hostel,NULL,false,false\)/);
  const legacyJoin = read('supabase/migrations/Run1.sql');
  const joinStart = legacyJoin.indexOf('create or replace function public.join_hostel');
  const joinEnd = legacyJoin.indexOf('\n$$;', joinStart);
  const joinSql = legacyJoin.slice(joinStart, joinEnd + 4);
  assert.match(joinSql, /upper\(join_code\)=upper\(btrim\(p_join_code\)\)/);
  assert.doesNotMatch(joinSql, /length\(btrim\(p_join_code\)\)|\{8\}|\{12\}/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.create_hostel_secure\(text,text\) TO authenticated/);
});

test('Invitation tokens are high-entropy and stored only as SHA-256 hashes', () => {
  const create = functionSql('manager_create_hostel_invite_link');
  const resolve = functionSql('resolve_hostel_invite_link', 'private');
  const list = functionSql('manager_list_hostel_invite_links');
  assert.match(create, /PERFORM private\.assert_signed_in\(\)/);
  assert.match(create, /private\.assert_hostel_manager\(v_hostel,NULL,false,false\)/);
  assert.match(create, /gen_random_bytes\(32\)/);
  assert.match(create, /digest\(v_token,'sha256'\)/);
  assert.match(create, /v_exp>now\(\)\+interval '30 days'/);
  assert.match(resolve, /p_token !~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(resolve, /digest\(p_token,'sha256'\)/);
  assert.match(resolve, /revoked_at IS NULL[\s\S]*?starts_at<=now\(\)[\s\S]*?expires_at>now\(\)/);
  assert.doesNotMatch(list, /'token'\s*,/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.manager_create_hostel_invite_link\(timestamptz,text\) FROM PUBLIC,anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.manager_create_hostel_invite_link\(timestamptz,text\) TO authenticated/);
});

test('Join Requests require authentication and explicit manager/assistant approval', () => {
  const create = functionSql('create_hostel_join_request_from_link');
  const review = functionSql('manager_review_hostel_join_request');
  const list = functionSql('manager_list_hostel_join_requests');
  assert.match(create, /PERFORM private\.assert_signed_in\(\)/);
  assert.match(create, /WHERE user_id=v_user AND status='active'/);
  assert.match(create, /already_member/);
  assert.match(create, /RAISE EXCEPTION[\s\S]*?23505/);
  assert.match(create, /ON CONFLICT \(user_id\) WHERE status='pending' DO NOTHING/);
  assert.match(migration, /hostel_join_requests_one_pending_user_idx[\s\S]*?ON public\.hostel_join_requests\(user_id\) WHERE status='pending'/);
  assert.match(list, /private\.assert_hostel_manager\(v_hostel,NULL,false,false\)/);
  assert.match(review, /private\.assert_hostel_manager\(v_hostel,NULL,false,false\)/);
  assert.match(review, /WHERE id=p_request_id AND hostel_id=v_hostel FOR UPDATE/);
  assert.match(review, /status='active' AND hostel_id<>v_hostel/);
  assert.match(review, /role='member'/);
  assert.match(review, /DELETE FROM public\.period_assistant_managers/);
  assert.match(review, /UPDATE public\.archive_edit_permissions\s+SET revoked_at/);
  assert.match(review, /status='rejected'/);
  assert.match(manager, /managerCreateHostelInviteLink/);
  assert.match(manager, /managerRevokeHostelInviteLink/);
  assert.match(manager, /managerListHostelJoinRequests/);
  assert.match(manager, /managerReviewHostelJoinRequest/);
});


test('Pending invite requests cannot be bypassed through normal Join/Create RPCs', () => {
  const createHostel = lastFunctionSql('create_hostel_secure');
  const joinHostel = lastFunctionSql('join_hostel');
  const createRequest = functionSql('create_hostel_join_request_from_link');
  const review = functionSql('manager_review_hostel_join_request');
  assert.match(createHostel, /lock_hostel_membership_transition\(v_user\)/);
  assert.match(createHostel, /assert_no_pending_hostel_join_request\(v_user\)/);
  assert.match(joinHostel, /lock_hostel_membership_transition\(v_user\)/);
  assert.match(joinHostel, /assert_no_pending_hostel_join_request\(v_user\)/);
  assert.match(createRequest, /lock_hostel_membership_transition\(v_user\)/);
  assert.match(createRequest, /WHERE user_id=v_user AND status='pending'/);
  assert.match(createRequest, /অন্য একটি মেসে Join Request অপেক্ষমাণ/);
  assert.match(review, /SELECT user_id INTO v_request_user/);
  assert.match(review, /lock_hostel_membership_transition\(v_request_user\)/);
  assert.match(migration, /REVOKE ALL ON FUNCTION private\.lock_hostel_membership_transition\(uuid\) FROM PUBLIC,anon,authenticated/);
  assert.match(migration, /REVOKE ALL ON FUNCTION private\.assert_no_pending_hostel_join_request\(uuid\) FROM PUBLIC,anon,authenticated/);
});

test('Invitation page reveals no hostel information before authentication', () => {
  const invitePage = read('src/features/invites/HostelInvitePage.jsx');
  const unauthBranch = invitePage.slice(invitePage.indexOf('{!auth.isAuthenticated ?'), invitePage.indexOf(': <>', invitePage.indexOf('{!auth.isAuthenticated ?')));
  assert.match(unauthBranch, /মেসের কোনো তথ্য বা ড্যাশবোর্ড দেখতে হলে আগে নিজের অ্যাকাউন্টে লগইন করতে হবে/);
  assert.doesNotMatch(unauthBranch, /info\?\.hostel_name|info\.hostel_name/);
  assert.match(invitePage, /getHostelInviteLinkInfo\(token\)/);
  assert.match(invitePage, /createHostelJoinRequestFromInvite\(token, requestNote\)/);
  assert.match(app, /getPendingHostelLinkToken\(\)/);
  assert.match(app, /pathname === '\/invite'[\s\S]*?window\.location\.hash/);
  assert.match(helper, /TOKEN_PATTERN = \/\^\[0-9a-f\]\{64\}\$\//);
  assert.match(onboarding, /clearPendingHostelLinkToken\(\)/);
});

test('Session limit counts valid Supabase sessions, not stale sessions or browser tabs', () => {
  const currentSession = functionSql('is_current_auth_session_allowed', 'private');
  const enforce = functionSql('hl_enforce_my_session_limit');
  assert.match(currentSession, /auth\.jwt\(\)->>'session_id'/);
  assert.match(currentSession, /auth\.sessions s[\s\S]*?s\.not_after IS NULL OR s\.not_after>now\(\)/);
  assert.match(enforce, /pg_advisory_xact_lock/);
  assert.match(enforce, /count\(\*\)[\s\S]*?s\.not_after IS NULL OR s\.not_after>now\(\)/);
  assert.match(enforce, /row_number\(\) OVER \(ORDER BY s\.created_at ASC,s\.id ASC\)/);
  assert.match(migration, /AS RESTRICTIVE FOR ALL TO authenticated USING \(private\.is_current_auth_session_allowed\(\)\) WITH CHECK \(private\.is_current_auth_session_allowed\(\)\)/);
  assert.match(migration, /ALTER TABLE public\.%I ENABLE ROW LEVEL SECURITY/);
  for (const table of ['archive_period_audit','platform_settings','platform_access_codes','platform_audit_log','platform_retention_policy','platform_notification_preferences','hl_period_summary_snapshots','hl_archived_final_summaries','hostel_pinned_announcements','hostel_access_links','hostel_join_requests']) {
    assert.match(migration, new RegExp(`'${table}'`), `Session guard missing ${table}`);
  }
  assert.match(migration, /CREATE POLICY run28_session_limit_guard ON storage\.objects[\s\S]*?FOR ALL TO authenticated/);
  assert.match(authContext, /hl_enforce_my_session_limit/);
  assert.match(authContext, /hostel-life-session-limit-notice/);
  assert.match(authPage, /hostel-life-session-limit-notice/);
  assert.match(authPage, /role="alert"/);
  assert.match(platform, /Array\.from\(\{ length: 30 \}/);
});

test('Device policy and default theme remain Super Admin controlled and personal themes stay preferred', () => {
  assert.match(migration, /default_theme IN \('system','light','dark','blue'\)/);
  assert.match(migration, /max_devices_per_user BETWEEN 1 AND 30/);
  assert.match(migration, /IF NOT private\.is_super_admin\(\)/);
  assert.match(migration, /'default_theme',s\.default_theme/);
  assert.match(read('src/app/theme.js'), /readThemeKey\(THEME_KEY\) \|\| readThemeKey\(THEME_DEFAULT_KEY\)/);
  assert.match(read('src/app/theme.js'), /Do not overwrite an explicit preference/);
  assert.match(platform, /platformAdminSetDefaultTheme/);
  assert.match(platform, /platformAdminSetMaxDevicesPerUser/);
});

test('PWA install page, first-entry prompt and theme-aware Help page are present', () => {
  assert.match(menu, /অ্যাপ ডাউনলোড/);
  const assistantStart = menu.indexOf('const assistantItems = [');
  const assistantEnd = menu.indexOf('];', assistantStart);
  assert.ok(assistantStart >= 0 && assistantEnd > assistantStart, 'Assistant menu declaration must exist');
  assert.match(menu.slice(assistantStart, assistantEnd), /join-requests/);
  assert.match(appDownload, /এখনই ইনস্টল করুন/);
  assert.doesNotMatch(appDownload, /INSTALL GUIDE|app-download-steps/);
  assert.match(read('src/app/AppShell.jsx'), /hostel-life-install-nudge-v1/);
  assert.match(read('src/app/AppShell.jsx'), /useInstallPrompt/);
  assert.match(onboarding, /useInstallPrompt/);
  assert.match(onboarding, /hostel-life-install-nudge-v1/);
  assert.match(onboarding, /setTimeout\(\(\) => setInstallNudgeOpen\(true\), 2600\)/);
  assert.match(downloadCss, /\.howto-page \.howto-faq-group-heading/);
  assert.match(downloadCss, /\.howto-page \.howto-faq-answer/);
  assert.match(howTo, /Invitation Link দিয়ে কীভাবে নিরাপদে যুক্ত হব\?/);
  assert.match(howTo, /Hostel Life অ্যাপ কীভাবে ইনস্টল করব\?/);
});

test('Vercel and Service Worker protect invitation tokens from caching and referrer leakage', () => {
  assert.ok(vercel.rewrites.some((route) => route.source === '/invite' && route.destination === '/index.html'));
  assert.ok(vercel.rewrites.some((route) => route.source === '/invite/(.*)' && route.destination === '/index.html'));
  assert.ok(!vercel.rewrites.some((route) => route.source.includes('public-hostel')));
  const inviteHeaders = ['/invite', '/invite/(.*)'].map((route) => vercel.headers.find((item) => item.source === route));
  assert.ok(inviteHeaders.every(Boolean));
  for (const header of inviteHeaders) {
    const values = Object.fromEntries(header.headers.map((entry) => [entry.key.toLowerCase(), entry.value.toLowerCase()]));
    assert.match(values['cache-control'], /no-store/);
    assert.equal(values['referrer-policy'], 'no-referrer');
    assert.match(values['x-robots-tag'], /noindex/);
  }
  assert.match(read('src/features/manager/ManagerPages.jsx'), /\/invite#\$\{result\.token\}/);
  assert.match(read('public/service-worker.js'), /url\.pathname === '\/invite'[\s\S]*?fetch\(request, \{ cache: 'no-store' \}\)/);
  assert.match(read('public/service-worker.js'), /url\.pathname\.startsWith\('\/invite\/'\)[\s\S]*?fetch\(request, \{ cache: 'no-store' \}\)/);
});

test('Selected-hostel Backup Assistant discovers new hostel_id tables dynamically', () => {
  assert.match(backupCore, /SELECT table_schema, table_name, column_name, data_type/);
  assert.match(backupCore, /if table_key == root_key or "hostel_id" not in names/);
  assert.match(backupCore, /rows = _query_rows\(conn, schema, table, '"hostel_id" = %s', \[hostel_id\]\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.hostel_access_links[\s\S]*?hostel_id uuid NOT NULL/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.hostel_join_requests[\s\S]*?hostel_id uuid NOT NULL/);
});
