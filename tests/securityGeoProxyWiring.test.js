import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('Supabase client routes only the four intended security Functions when Worker URL is configured', () => {
  const source = read('src/lib/supabase.js');
  for (const pathName of ['auth-security-gate', 'record-auth-event', 'request-password-reset', 'request-signup-otp']) {
    assert.match(source, new RegExp(pathName));
  }
  assert.match(source, /global:\s*\{\s*fetch:\s*createSecurityAwareFetch\(\)/);
  assert.match(source, /VITE_HOSTEL_SECURITY_WORKER_URL/);
  assert.match(source, /requestUrl\.origin === supabaseOrigin && SECURITY_FUNCTION_PATHS\.has\(requestUrl\.pathname\)/);
  assert.match(source, /SECURITY_FUNCTION_PATHS\.has\(requestUrl\.pathname\)/);
  assert.match(source, /securityGeoProxyEnabled = Boolean\(securityWorkerOrigin\)/, 'only a valid optional Worker origin is enabled');
  assert.match(source, /optional signed Geo\/edge layer/);
  assert.match(source, /requestUrl\.href, request\.clone\(\)/, 'proxy failures can retry through direct Supabase ingress');
});

test('optional pre-auth IP/email gate does not block Supabase Auth when unavailable', () => {
  const auth = read('src/services/authService.js');
  assert.match(auth, /Optional IP\/email security gate unavailable/i);
  assert.doesNotMatch(auth, /SECURITY_GATE_UNAVAILABLE/);
});

test('All four Edge Functions require HMAC verification when a Worker marker is present', () => {
  for (const name of ['auth-security-gate', 'record-auth-event', 'request-password-reset', 'request-signup-otp']) {
    const source = read(`supabase/functions/${name}/index.ts`);
    assert.match(source, /resolveTrustedVisitor\(request, ['"](?:auth-security-gate|record-auth-event|request-password-reset|request-signup-otp)['"], (?:consumeGeoNonce|consumeNonce)\)/);
    assert.match(source, /visitor\.ok/);
  }
  const helper = read('supabase/functions/_shared/geoProxy.ts');
  assert.match(helper, /HOSTEL_GEO_PROXY_HMAC_SECRET/);
  assert.match(helper, /crypto\.subtle\.verify\('HMAC'/);
  assert.match(helper, /GEO_PROXY_SIGNATURE_INVALID/);
  assert.match(helper, /GEO_PROXY_NONCE_REPLAYED_OR_EXPIRED/);
  assert.match(helper, /consumeNonce\(nonce, timestamp\)/);
  assert.match(helper, /proxyMarker === 'v1'/);
  assert.doesNotMatch(helper, /HOSTEL_GEO_PROXY_REQUIRED|GEO_PROXY_REQUIRED/);
});

test('Worker CORS and upstream proxy whitelist exclude administrative Functions and Auth API paths', () => {
  const worker = read('cloudflare/hostel-life-security-proxy/src/index.js');
  assert.match(worker, /\/functions\/v1\/auth-security-gate/);
  assert.match(worker, /\/functions\/v1\/record-auth-event/);
  assert.match(worker, /\/functions\/v1\/request-password-reset/);
  assert.match(worker, /\/functions\/v1\/request-signup-otp/);
  assert.match(worker, /request-signup-otp', new Set\(\['GET', 'POST'\]\)/);
  assert.doesNotMatch(worker, /\/functions\/v1\/admin-delete-unlinked-user/);
  assert.match(worker, /apikey/);
  assert.match(worker, /ALLOWED_ORIGINS/);
});


test('Password reset validates the signed body hash before consuming the original request body', () => {
  const reset = read('supabase/functions/request-password-reset/index.ts');
  const verified = reset.indexOf("const visitor = await resolveTrustedVisitor(request, 'request-password-reset', consumeGeoNonce)");
  const consumed = reset.indexOf('request.text();');
  assert.ok(verified >= 0 && consumed > verified, 'HMAC body clone must run before request.text()');
});


test('Signup OTP resend is subject to the same server-side auth IP deny-list', () => {
  const edge = read('supabase/functions/request-signup-otp/index.ts');
  const visitor = edge.indexOf("resolveTrustedVisitor(request, 'request-signup-otp'");
  const block = edge.indexOf("admin.rpc('hl_check_auth_ip_block_v2'");
  const quota = edge.indexOf("admin.rpc('hl_consume_signup_otp_resend'");
  assert.ok(visitor >= 0 && block > visitor && quota > block, 'verified visitor and auth IP block must be checked before OTP quota/resend');
  assert.match(edge, /AUTH_IP_TEMPORARILY_BLOCKED/);
});

test('Record-auth-event health reports the attempted-email database column readiness', () => {
  const edge = read('supabase/functions/record-auth-event/index.ts');
  assert.match(edge, /attempt_email_column_ready: Boolean\(health\?\.attempt_email_column_ready\)/);
});
