import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('Supabase client routes only the three intended security Functions when Worker URL is configured', () => {
  const source = read('src/lib/supabase.js');
  for (const pathName of ['auth-security-gate', 'record-auth-event', 'request-password-reset']) {
    assert.match(source, new RegExp(pathName));
  }
  assert.match(source, /global:\s*\{\s*fetch:\s*createSecurityAwareFetch\(\)/);
  assert.match(source, /VITE_HOSTEL_SECURITY_WORKER_URL/);
  assert.match(source, /requestUrl\.origin === supabaseOrigin && SECURITY_FUNCTION_PATHS\.has\(requestUrl\.pathname\)/);
  assert.match(source, /SECURITY_FUNCTION_PATHS\.has\(requestUrl\.pathname\)/);
  assert.match(source, /securityGeoProxyEnabled = Boolean\(workerUrlValue\)/, 'a malformed but configured Worker URL must still count as proxy-enabled');
  assert.match(source, /security proxy URL is invalid/, 'invalid Worker configuration must fail closed');
  assert.match(source, /could not prepare the protected request/, 'request construction errors must not fall back to direct Supabase');
});

test('Worker proxy mode fails closed when the pre-auth IP gate cannot be reached', () => {
  const auth = read('src/services/authService.js');
  assert.match(auth, /securityGeoProxyEnabled/);
  assert.match(auth, /SECURITY_GATE_UNAVAILABLE/);
});

test('All three Edge Functions require HMAC verification when a Worker marker is present', () => {
  for (const name of ['auth-security-gate', 'record-auth-event', 'request-password-reset']) {
    const source = read(`supabase/functions/${name}/index.ts`);
    assert.match(source, /resolveTrustedVisitor\(request, ['"](?:auth-security-gate|record-auth-event|request-password-reset)['"]\)/);
    assert.match(source, /visitor\.ok/);
  }
  const helper = read('supabase/functions/_shared/geoProxy.ts');
  assert.match(helper, /HOSTEL_GEO_PROXY_HMAC_SECRET/);
  assert.match(helper, /crypto\.subtle\.verify\('HMAC'/);
  assert.match(helper, /GEO_PROXY_SIGNATURE_INVALID/);
  assert.match(helper, /request\.headers\.get\('x-hostel-geo-proxy'\) === 'v1'/);
});

test('Worker CORS and upstream proxy whitelist exclude administrative Functions and Auth API paths', () => {
  const worker = read('cloudflare/hostel-life-security-proxy/src/index.js');
  assert.match(worker, /\/functions\/v1\/auth-security-gate/);
  assert.match(worker, /\/functions\/v1\/record-auth-event/);
  assert.match(worker, /\/functions\/v1\/request-password-reset/);
  assert.doesNotMatch(worker, /\/functions\/v1\/admin-delete-unlinked-user/);
  assert.match(worker, /apikey/);
  assert.match(worker, /ALLOWED_ORIGINS/);
});


test('Password reset validates the signed body hash before consuming the original request body', () => {
  const reset = read('supabase/functions/request-password-reset/index.ts');
  const verified = reset.indexOf("const visitor = await resolveTrustedVisitor(request, 'request-password-reset')");
  const consumed = reset.indexOf('request.text();');
  assert.ok(verified >= 0 && consumed > verified, 'HMAC body clone must run before request.text()');
});
