import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'src/app/App.jsx'), 'utf8');
const auth = fs.readFileSync(path.join(root, 'src/contexts/AuthContext.jsx'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src/features/platform/SuperAdminPage.jsx'), 'utf8');

test('authenticated Super Admin route renders before the generic identityReady gate', () => {
  const authLoading = app.indexOf('if (auth.authLoading)');
  const unauthenticated = app.indexOf('if (!auth.isAuthenticated) return withPublicCommunications(<AuthPage pathname="/auth/login" />);');
  const superAdminRoute = app.indexOf("if (pathname === '/super-admin') return withPublicCommunications(<SuperAdminPage user={auth.user} />);");
  const identityGate = app.indexOf("if (auth.isAuthenticated && pathname !== '/auth/reset-password' && !auth.identityReady)");
  assert.ok(authLoading >= 0 && unauthenticated > authLoading);
  assert.ok(superAdminRoute > unauthenticated && identityGate > superAdminRoute,
    'Super Admin must remain mounted while the same-user MFA session upgrade refreshes identity');
});

test('the route guard does not redirect an authenticated Super Admin during identity refresh', () => {
  const routeGuard = app.indexOf("if (pathname === '/super-admin') {");
  const nextGuard = app.indexOf("const inAuth = pathname.startsWith('/auth/');", routeGuard);
  assert.ok(routeGuard >= 0 && nextGuard > routeGuard);
  const routeBlock = app.slice(routeGuard, nextGuard);
  assert.match(routeBlock, /if \(!auth\.isAuthenticated\)/);
  assert.match(routeBlock, /return;/);
});

test('MFA verification updates the same authenticated session without bypassing Super Admin local verification', () => {
  assert.match(auth, /onAuthStateChange\(\(event, nextSession\) =>/);
  assert.match(auth, /setSession\(nextSession \?\? null\)/);
  assert.match(page, /supabase\.auth\.mfa\.verify\(/);
  assert.match(page, /setReauthenticated\(true\)/);
  assert.match(page, /activeAssurance\?\.currentLevel !== 'aal2'/);
});
