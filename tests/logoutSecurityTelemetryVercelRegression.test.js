import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const auth = fs.readFileSync('src/contexts/AuthContext.jsx', 'utf8');
const onboarding = fs.readFileSync('src/features/onboarding/OnboardingPage.jsx', 'utf8');
const edge = fs.readFileSync('supabase/functions/record-auth-event/index.ts', 'utf8');
const admin = fs.readFileSync('src/features/platform/SuperAdminPage.jsx', 'utf8');
const service = fs.readFileSync('src/services/platformService.js', 'utf8');
const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
const sw = fs.readFileSync('public/service-worker.js', 'utf8');
const authService = fs.readFileSync('src/services/authService.js', 'utf8');

test('onboarding logout cannot be held indefinitely by the optional audit RPC', () => {
  assert.match(auth, /LOGOUT_AUDIT_TIMEOUT_MS\s*=\s*1500/);
  assert.match(auth, /Promise\.race\(/);
  assert.match(auth, /recordLogoutBestEffort\(\)/);
  assert.match(auth, /supabase\.auth\.signOut\(\{ scope: 'local' \}\)/);
  assert.match(auth, /getSession\(\)/);
  assert.match(onboarding, /await signOutLocal\(\)/);
});

test('remote signout acknowledgement failures are distinguished from local logout state', () => {
  assert.match(auth, /remoteRevocationConfirmed/);
  assert.match(auth, /if \(data\?\.session\) throw/);
  assert.match(onboarding, /remoteRevocationConfirmed === false/);
});

test('security telemetry supports a read-only health probe that checks the Run27 RPC without inserting events', () => {
  assert.match(edge, /request\.method === 'GET'/);
  assert.match(edge, /__hostel_life_health_check__/);
  assert.match(edge, /error\?\.code === '22023'/);
  assert.match(edge, /database_rpc_ready: true/);
  assert.match(admin, /platformAdminCheckSecurityTelemetry/);
  assert.match(service, /functions\.invoke\('record-auth-event', \{ method: 'GET' \}\)/);
});

test('security panel warns when telemetry ingestion is not ready instead of presenting zero as definitive', () => {
  assert.match(admin, /Security Telemetry সংযোগ যাচাই ব্যর্থ/);
  assert.match(admin, /শূন্য সংখ্যাকে প্রকৃত নিরাপত্তা-তথ্য ধরে নেবেন না/);
  assert.match(authService, /Security telemetry delivery failed/);
});

test('Edge Function can use Supabase-provided secret keys and a server-only HMAC fallback', () => {
  assert.match(edge, /SUPABASE_SECRET_KEYS/);
  assert.match(edge, /configuredHmacSecret \|\| adminKey/);
  assert.doesNotMatch(edge, /body\.password|p_password/);
});

test('Vercel supports the exact onboarding route and the standard Vite SPA fallback', () => {
  assert.ok(vercel.rewrites.some((route) => route.source === '/onboarding' && route.destination === '/index.html'));
  assert.ok(vercel.rewrites.some((route) => route.source === '/(.*)' && route.destination === '/index.html'));
  assert.match(sw, /hostel-life-shell-v17/);
  assert.match(sw, /const cached = await cache\.match\(cacheKey\);\n    return cached \|\| response;/);
});
