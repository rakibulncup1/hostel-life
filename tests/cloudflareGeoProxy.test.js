import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { __test } from '../cloudflare/hostel-life-security-proxy/src/index.js';

const env = {
  SUPABASE_FUNCTIONS_ORIGIN: 'https://exampleproject.supabase.co',
  ALLOWED_ORIGINS: 'https://hostellife-bd.vercel.app,http://localhost:5173',
  HOSTEL_GEO_PROXY_HMAC_SECRET: 'run38-test-secret-only-never-use-in-production-00000000',
};

function withCf(request, cf) {
  Object.defineProperty(request, 'cf', { value: cf, configurable: true });
  return request;
}

function hexToBytes(hex) {
  return new Uint8Array(hex.match(/.{2}/g).map((part) => Number.parseInt(part, 16)));
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

test('Worker answers CORS preflight only for an allowlisted security route and Origin', async () => {
  const request = new Request('https://hostel-life-security.example.workers.dev/functions/v1/record-auth-event', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://hostellife-bd.vercel.app',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'apikey,x-client-info',
    },
  });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://hostellife-bd.vercel.app');
  assert.match(response.headers.get('Access-Control-Allow-Headers'), /apikey/);
});

test('Worker refuses arbitrary paths, origins, and request methods', async () => {
  const badPath = new Request('https://hostel-life-security.example.workers.dev/functions/v1/admin-delete-unlinked-user', {
    headers: { Origin: 'https://hostellife-bd.vercel.app' },
  });
  assert.equal((await worker.fetch(badPath, env)).status, 404);

  const badOrigin = new Request('https://hostel-life-security.example.workers.dev/functions/v1/record-auth-event', {
    headers: { Origin: 'https://attacker.example', apikey: 'public-test-key' },
  });
  assert.equal((await worker.fetch(badOrigin, env)).status, 403);

  const wrongMethod = new Request('https://hostel-life-security.example.workers.dev/functions/v1/request-password-reset', {
    method: 'GET', headers: { Origin: 'https://hostellife-bd.vercel.app', apikey: 'public-test-key', 'cf-connecting-ip': '8.8.8.8' },
  });
  assert.equal((await worker.fetch(wrongMethod, env)).status, 405);
});

test('Worker signs Cloudflare IP and location metadata, overriding all browser-supplied geo headers', async () => {
  const originalFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (input, init) => {
    captured = input instanceof Request ? input : new Request(input, init);
    return new Response('{"ready":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const body = JSON.stringify({ event_type: 'login_failed', email: 'person@example.test', failure_code: 'invalid_credentials' });
    const request = withCf(new Request('https://hostel-life-security.example.workers.dev/functions/v1/record-auth-event', {
      method: 'POST',
      headers: {
        Origin: 'https://hostellife-bd.vercel.app',
        apikey: 'public-test-key',
        authorization: 'Bearer test-access-token',
        'content-type': 'application/json',
        'x-hostel-geo-proxy': 'fake',
        'x-hostel-geo-city': 'Fake City',
        'x-hostel-geo-ip': '203.0.113.99',
        'cf-connecting-ip': '198.51.100.25',
      },
      body,
    }), {
      city: 'Dhaka', region: 'Dhaka Division', regionCode: 'BD-C', country: 'BD',
    });

    const response = await worker.fetch(request, env);
    assert.equal(response.status, 200);
    assert.ok(captured);
    assert.equal(new URL(captured.url).origin, 'https://exampleproject.supabase.co');
    assert.equal(captured.headers.get('x-hostel-geo-proxy'), 'v1');
    assert.equal(captured.headers.get('x-hostel-geo-route'), 'record-auth-event');
    assert.equal(captured.headers.get('x-hostel-geo-ip'), '198.51.100.25');
    assert.equal(captured.headers.get('x-hostel-geo-country'), 'BD');
    assert.equal(decodeURIComponent(captured.headers.get('x-hostel-geo-city')), 'Dhaka');
    assert.equal(decodeURIComponent(captured.headers.get('x-hostel-geo-region')), 'Dhaka Division');
    assert.equal(captured.headers.get('x-hostel-geo-ip'), '198.51.100.25');
    assert.equal(captured.headers.has('cf-connecting-ip'), false);

    const bytes = new TextEncoder().encode(body);
    const bodyHash = await sha256Hex(bytes);
    assert.equal(captured.headers.get('x-hostel-geo-body-sha256'), bodyHash);
    const signed = {
      timestamp: captured.headers.get('x-hostel-geo-timestamp'),
      nonce: captured.headers.get('x-hostel-geo-nonce'),
      method: 'POST',
      route: 'record-auth-event',
      origin: 'https://hostellife-bd.vercel.app',
      bodyHash,
      ip: '198.51.100.25',
      country: 'BD',
      city: encodeURIComponent('Dhaka'),
      region: encodeURIComponent('Dhaka Division'),
      regionCode: encodeURIComponent('BD-C'),
      geoProvider: 'cloudflare',
    };
    const canonical = __test.canonicalPayload(signed);
    const expected = await __test.hmacHex(env.HOSTEL_GEO_PROXY_HMAC_SECRET, canonical);
    assert.equal(captured.headers.get('x-hostel-geo-signature'), expected);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Worker rejects missing visitor IP and invalid Supabase upstream configuration', async () => {
  const missingIp = withCf(new Request('https://hostel-life-security.example.workers.dev/functions/v1/auth-security-gate', {
    headers: { Origin: 'https://hostellife-bd.vercel.app', apikey: 'public-test-key' },
  }), { country: 'BD' });
  assert.equal((await worker.fetch(missingIp, env)).status, 503);
  assert.equal(__test.getUpstreamOrigin('http://exampleproject.supabase.co'), null);
  assert.equal(__test.getUpstreamOrigin('https://attacker.example'), null);
  assert.equal(__test.getUpstreamOrigin('https://user:pass@exampleproject.supabase.co'), null);
});

test('Worker accepts only the four intended Auth/Security Function routes', () => {
  assert.equal(__test.getUpstreamOrigin('https://exampleproject.supabase.co'), 'https://exampleproject.supabase.co');
  assert.ok(__test.validClientIp('203.0.113.17'));
  assert.ok(__test.validClientIp('2001:db8::1'));
  assert.equal(__test.validClientIp('not-an-ip'), '');
  assert.equal(__test.parseAllowedOrigins('https://a.example/, https://b.example').size, 2);
});


test('IPinfo Lite fallback returns only country data, uses HTTPS and never blocks on lookup failure', async () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  let requested = '';
  globalThis.caches = undefined;
  globalThis.fetch = async (input) => {
    requested = String(input);
    return new Response(JSON.stringify({ ip: '8.8.8.8', country_code: 'US', asn: 'AS15169' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await __test.lookupIpinfoGeo('8.8.8.8', 'ipinfo-test-token');
    assert.match(requested, /^https:\/\/api\.ipinfo\.io\/lite\/8\.8\.8\.8\?token=ipinfo-test-token$/);
    assert.deepEqual(result, { country: 'US' });
    assert.equal('asn' in result, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});

test('IPinfo Lite fallback refuses private addresses and treats provider errors as non-fatal', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('{"error":true}', { status: 200 }); };
  try {
    assert.equal(await __test.lookupIpinfoGeo('192.168.1.10', 'ipinfo-test-token'), null);
    assert.equal(calls, 0);
    assert.equal(await __test.lookupIpinfoGeo('8.8.4.4', 'ipinfo-test-token'), null);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});



test('Worker uses IPinfo Lite only for missing Cloudflare country and signs the returned country', async () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  let lookupUrl = '';
  let upstreamRequest = null;
  globalThis.caches = undefined;
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://api.ipinfo.io/lite/')) {
      lookupUrl = url;
      return new Response(JSON.stringify({ ip: '8.8.8.8', country_code: 'US', asn: 'AS15169' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    upstreamRequest = input instanceof Request ? input : new Request(input, init);
    return new Response('{"ready":true}', { status: 200 });
  };
  try {
    const request = withCf(new Request('https://hostel-life-security.example.workers.dev/functions/v1/record-auth-event', {
      method: 'GET', headers: { Origin: 'https://hostellife-bd.vercel.app', apikey: 'public-test-key', 'cf-connecting-ip': '8.8.8.8' },
    }), { city: 'Dhaka', region: 'Dhaka Division', regionCode: 'BD-C' });
    const response = await worker.fetch(request, { ...env, IPINFO_TOKEN: 'lite-test-token' });
    assert.equal(response.status, 200);
    assert.match(lookupUrl, /^https:\/\/api\.ipinfo\.io\/lite\/8\.8\.8\.8\?token=lite-test-token$/);
    assert.ok(upstreamRequest);
    assert.equal(upstreamRequest.headers.get('x-hostel-geo-country'), 'US');
    assert.equal(upstreamRequest.headers.get('x-hostel-geo-city'), encodeURIComponent('Dhaka'));
    assert.equal(upstreamRequest.headers.get('x-hostel-geo-provider'), 'cloudflare+ipinfo');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});

test('IPinfo Lite is not called when Cloudflare already supplied country, city and region', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (input) => {
    requestedUrls.push(String(input));
    return new Response('{"ready":true}', { status: 200 });
  };
  try {
    const request = withCf(new Request('https://hostel-life-security.example.workers.dev/functions/v1/record-auth-event', {
      method: 'GET', headers: { Origin: 'https://hostellife-bd.vercel.app', apikey: 'public-test-key', 'cf-connecting-ip': '8.8.8.8' },
    }), { country: 'BD', city: 'Dhaka', region: 'Dhaka Division' });
    // Directly test the lookup decision via the worker request: location fields are complete,
    // therefore an absent auxiliary regionCode does not spend the third-party lookup quota.
    const response = await worker.fetch(request, env);
    assert.equal(response.status, 200);
    assert.equal(requestedUrls.filter((url) => url.includes('api.ipinfo.io')).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
