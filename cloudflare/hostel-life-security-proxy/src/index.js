const ALLOWED_ROUTES = new Map([
  ['/functions/v1/auth-security-gate', new Set(['GET', 'POST'])],
  ['/functions/v1/record-auth-event', new Set(['GET', 'POST'])],
  ['/functions/v1/request-password-reset', new Set(['POST'])],
]);
const MAX_BODY_BYTES = 8192;
const CORS_HEADERS = 'authorization, apikey, x-client-info, content-type';

function json(body, status, origin = '') {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
  });
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', CORS_HEADERS);
    headers.set('Access-Control-Max-Age', '600');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function parseAllowedOrigins(value) {
  return new Set(String(value || '').split(',').map((item) => item.trim().replace(/\/$/, '')).filter(Boolean));
}

function validIpv4(value) {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function validIpv6(value) {
  if (!value.includes(':') || value.length > 45 || value.includes(':::')) return false;
  let normalized = value;
  if (value.includes('.')) {
    const separator = value.lastIndexOf(':');
    if (separator < 0 || !validIpv4(value.slice(separator + 1))) return false;
    normalized = `${value.slice(0, separator)}:ipv4`;
  }
  if (!/^[0-9a-fA-F:]+$/.test(normalized.replace('ipv4', 'a'))) return false;
  const sides = normalized.split('::');
  if (sides.length > 2) return false;
  const countGroups = (side) => {
    if (!side) return 0;
    let count = 0;
    for (const item of side.split(':')) {
      if (item === 'ipv4') count += 2;
      else if (/^[0-9a-fA-F]{1,4}$/.test(item)) count += 1;
      else return null;
    }
    return count;
  };
  const left = countGroups(sides[0]);
  const right = sides.length === 2 ? countGroups(sides[1]) : 0;
  if (left === null || right === null) return false;
  return sides.length === 2 ? left + right < 8 : left + right === 8;
}

function validClientIp(value) {
  const ip = String(value || '').trim();
  return ip && ip.length <= 45 && (validIpv4(ip) || validIpv6(ip)) ? ip : '';
}

function safeLocation(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);
}

function encodeLocation(value, maxLength) {
  return encodeURIComponent(safeLocation(value, maxLength));
}

function toHex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(bytes) {
  return toHex(await crypto.subtle.digest('SHA-256', bytes));
}

function canonicalPayload(input) {
  return JSON.stringify([
    'hostel-life-geo-v1',
    input.timestamp,
    input.nonce,
    input.method.toUpperCase(),
    input.route,
    input.origin,
    input.bodyHash,
    input.ip,
    input.country,
    input.city,
    input.region,
    input.regionCode,
  ]);
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

function getUpstreamOrigin(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
  // Keep the Worker a narrow proxy to Supabase only; never allow user-controlled
  // URLs or an arbitrary internal host to become an SSRF target.
  if (!/^[a-z0-9-]+\.supabase\.co$/i.test(parsed.hostname)) return null;
  return parsed.origin;
}

export const __test = {
  canonicalPayload,
  getUpstreamOrigin,
  hmacHex,
  parseAllowedOrigins,
  validClientIp,
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const normalizedOrigin = origin.replace(/\/$/, '');
    const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
    const allowedMethods = ALLOWED_ROUTES.get(url.pathname);

    if (!allowedMethods) return json({ code: 'ROUTE_NOT_ALLOWED' }, 404, allowedOrigins.has(normalizedOrigin) ? origin : '');
    if (!origin || !allowedOrigins.has(normalizedOrigin)) return json({ code: 'ORIGIN_NOT_ALLOWED' }, 403);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': CORS_HEADERS,
          'Access-Control-Max-Age': '600',
          'Cache-Control': 'no-store',
          'Vary': 'Origin',
        },
      });
    }

    if (!allowedMethods.has(request.method)) return json({ code: 'METHOD_NOT_ALLOWED' }, 405, origin);
    if (url.search) return json({ code: 'QUERY_NOT_ALLOWED' }, 400, origin);
    if (!request.headers.get('apikey')) return json({ code: 'API_KEY_REQUIRED' }, 401, origin);

    const upstreamOrigin = getUpstreamOrigin(env.SUPABASE_FUNCTIONS_ORIGIN);
    const hmacSecret = String(env.HOSTEL_GEO_PROXY_HMAC_SECRET || '').trim();
    if (!upstreamOrigin || hmacSecret.length < 32) {
      return json({ code: 'PROXY_CONFIGURATION_MISSING' }, 503, origin);
    }

    const clientIp = validClientIp(request.headers.get('CF-Connecting-IP'));
    if (!clientIp) return json({ code: 'CLOUDFLARE_CLIENT_IP_UNAVAILABLE' }, 503, origin);

    let bodyBytes = new Uint8Array();
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      try {
        bodyBytes = new Uint8Array(await request.arrayBuffer());
      } catch {
        return json({ code: 'REQUEST_BODY_UNREADABLE' }, 400, origin);
      }
      if (bodyBytes.byteLength > MAX_BODY_BYTES) return json({ code: 'REQUEST_TOO_LARGE' }, 413, origin);
    }

    const cf = request.cf || {};
    const countryRaw = String(cf.country || '').trim().toUpperCase();
    const country = /^[A-Z]{2}$/.test(countryRaw) && countryRaw !== 'XX' ? countryRaw : '';
    const city = encodeLocation(cf.city, 100);
    const region = encodeLocation(cf.region, 100);
    const regionCode = encodeLocation(cf.regionCode, 20);
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const bodyHash = await sha256Hex(bodyBytes);
    const route = url.pathname.split('/').pop();
    const signed = {
      timestamp,
      nonce,
      method: request.method,
      route,
      origin: normalizedOrigin,
      bodyHash,
      ip: clientIp,
      country,
      city,
      region,
      regionCode,
    };
    const signature = await hmacHex(hmacSecret, canonicalPayload(signed));

    // Forward only the headers needed by Supabase Functions. Browser-supplied
    // CF/IP/location or x-hostel-geo headers are deliberately never forwarded.
    const headers = new Headers();
    for (const name of ['apikey', 'authorization', 'x-client-info', 'content-type', 'accept']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set('Origin', origin);
    headers.set('x-hostel-geo-proxy', 'v1');
    headers.set('x-hostel-geo-route', route);
    headers.set('x-hostel-geo-timestamp', timestamp);
    headers.set('x-hostel-geo-nonce', nonce);
    headers.set('x-hostel-geo-ip', clientIp);
    headers.set('x-hostel-geo-country', country);
    headers.set('x-hostel-geo-city', city);
    headers.set('x-hostel-geo-region', region);
    headers.set('x-hostel-geo-region-code', regionCode);
    headers.set('x-hostel-geo-body-sha256', bodyHash);
    headers.set('x-hostel-geo-signature', signature);

    const upstreamUrl = `${upstreamOrigin}${url.pathname}`;
    let upstreamResponse;
    try {
      upstreamResponse = await fetch(upstreamUrl, {
        method: request.method,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : bodyBytes,
        redirect: 'manual',
        cf: { cacheTtl: 0, cacheEverything: false },
      });
    } catch {
      return json({ code: 'SUPABASE_FUNCTION_UNREACHABLE' }, 502, origin);
    }

    const responseHeaders = new Headers(upstreamResponse.headers);
    responseHeaders.set('Access-Control-Allow-Origin', origin);
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', CORS_HEADERS);
    responseHeaders.set('Vary', 'Origin');
    responseHeaders.set('Cache-Control', 'no-store');
    responseHeaders.set('X-Content-Type-Options', 'nosniff');
    responseHeaders.set('X-Hostel-Geo-Proxy', 'v1');
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  },
};
