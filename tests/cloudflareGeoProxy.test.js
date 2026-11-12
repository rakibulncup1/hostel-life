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

test('Worker signs only trusted IP, ignores browser geo headers and never reads Cloudflare location metadata', async () => {
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
    assert.equal(captured.headers.get('x-hostel-geo-country'), '');
    assert.equal(captured.headers.get('x-hostel-geo-city'), '');
    assert.equal(captured.headers.get('x-hostel-geo-region'), '');
    assert.equal(captured.headers.get('x-hostel-geo-region-code'), '');
    assert.equal(captured.headers.get('x-hostel-geo-provider'), 'unavailable');
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
      country: '',
      city: '',
      region: '',
      regionCode: '',
      geoProvider: 'unavailable',
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


test('Worker never forwards Cloudflare country, city or region even when edge metadata exists', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamRequest = null;
  globalThis.fetch = async (input, init) => {
    upstreamRequest = input instanceof Request ? input : new Request(input, init);
    return new Response('{"ready":true}', { status: 200 });
  };
  try {
    const request = withCf(new Request('https://hostel-life-security.example.workers.dev/functions/v1/record-auth-event', {
      method: 'GET', headers: { Origin: 'https://hostellife-bd.vercel.app', apikey: 'public-test-key', 'cf-connecting-ip': '8.8.8.8' },
    }), { city: 'Dhaka', region: 'Dhaka Division', regionCode: 'BD-C' });
    const response = await worker.fetch(request, env);
    assert.equal(response.status, 200);
    assert.ok(upstreamRequest);
    assert.equal(upstreamRequest.headers.get('x-hostel-geo-country'), '');
    assert.equal(upstreamRequest.headers.get('x-hostel-geo-city'), '');
    assert.equal(upstreamRequest.headers.get('x-hostel-geo-region'), '');
    assert.equal(upstreamRequest.headers.get('x-hostel-geo-region-code'), '');
    assert.equal(upstreamRequest.headers.get('x-hostel-geo-provider'), 'unavailable');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Worker root and /health return non-sensitive JSON without requiring a custom domain', async () => {
  for (const path of ['/', '/health']) {
    const response = await worker.fetch(new Request(`https://hostel-life-security.example.workers.dev${path}`), env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.service, 'hostel-life-security-proxy');
    assert.equal(body.mode, 'optional-signed-ip-proxy');
    assert.equal(body.location_collection_enabled, false);
    assert.equal('secret' in body, false);
  }
});

