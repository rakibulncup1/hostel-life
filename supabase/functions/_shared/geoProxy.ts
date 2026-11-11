/**
 * Verify visitor metadata signed by the Hostel Life Cloudflare Worker.
 * Direct-to-Supabase requests continue to use the Cloudflare ingress IP.
 * Geo labels on the direct path remain display-only and are not trusted for
 * security decisions. A request marked as proxied must carry a valid HMAC.
 */
export type VisitorLocation = {
  countryCode: string | null;
  city: string | null;
  region: string | null;
  regionCode: string | null;
};

export type TrustedVisitor = {
  ok: boolean;
  ip: string | null;
  location: VisitorLocation;
  proxyVerified: boolean;
  source: 'cloudflare-worker' | 'supabase-edge' | 'unavailable';
  geoProvider?: string | null;
  code?: string;
};

const EMPTY_LOCATION: VisitorLocation = {
  countryCode: null,
  city: null,
  region: null,
  regionCode: null,
};

function isIpv4(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isIpv6(value: string): boolean {
  if (!value.includes(':') || value.length > 45 || value.includes(':::')) return false;
  let normalized = value;
  if (value.includes('.')) {
    const separator = value.lastIndexOf(':');
    if (separator < 0 || !isIpv4(value.slice(separator + 1))) return false;
    normalized = `${value.slice(0, separator)}:ipv4`;
  }
  if (!/^[0-9a-fA-F:]+$/.test(normalized.replace('ipv4', 'a'))) return false;
  const sides = normalized.split('::');
  if (sides.length > 2) return false;
  const countGroups = (side: string): number | null => {
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

function validIp(value: string | null): string | null {
  const ip = value?.trim() ?? '';
  if (!ip || ip.length > 45) return null;
  return isIpv4(ip) || isIpv6(ip) ? ip : null;
}

function clean(value: string | null, maxLength: number): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function decodeLocation(value: string | null, maxLength: number): string | null {
  if (!value) return null;
  try {
    return clean(decodeURIComponent(value), maxLength);
  } catch {
    return null;
  }
}

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function canonicalPayload(input: {
  timestamp: string;
  nonce: string;
  method: string;
  route: string;
  origin: string;
  bodyHash: string;
  ip: string;
  country: string;
  city: string;
  region: string;
  regionCode: string;
  geoProvider: string;
}): string {
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
    input.geoProvider,
  ]);
}

async function verifyProxyRequest(request: Request, expectedRoute: string, consumeNonce?: GeoNonceConsumer): Promise<TrustedVisitor> {
  const fail = (code: string): TrustedVisitor => ({
    ok: false, ip: null, location: EMPTY_LOCATION, proxyVerified: false, source: 'unavailable', geoProvider: null, code,
  });

  const secret = Deno.env.get('HOSTEL_GEO_PROXY_HMAC_SECRET')?.trim() ?? '';
  if (secret.length < 32) return fail('GEO_PROXY_SECRET_MISSING');

  const timestamp = request.headers.get('x-hostel-geo-timestamp') ?? '';
  const nonce = request.headers.get('x-hostel-geo-nonce') ?? '';
  const signature = request.headers.get('x-hostel-geo-signature') ?? '';
  const route = request.headers.get('x-hostel-geo-route') ?? '';
  const ip = validIp(request.headers.get('x-hostel-geo-ip'));
  const country = request.headers.get('x-hostel-geo-country') ?? '';
  const city = request.headers.get('x-hostel-geo-city') ?? '';
  const region = request.headers.get('x-hostel-geo-region') ?? '';
  const regionCode = request.headers.get('x-hostel-geo-region-code') ?? '';
  const geoProvider = request.headers.get('x-hostel-geo-provider') ?? '';
  const suppliedBodyHash = request.headers.get('x-hostel-geo-body-sha256') ?? '';

  const timestampNumber = Number(timestamp);
  if (!Number.isSafeInteger(timestampNumber) || Math.abs(Date.now() - timestampNumber) > 120_000) return fail('GEO_PROXY_SIGNATURE_EXPIRED');
  if (!/^[0-9a-f-]{36}$/i.test(nonce) || route !== expectedRoute || !ip) return fail('GEO_PROXY_METADATA_INVALID');
  if (country && !/^[A-Z]{2}$/.test(country)) return fail('GEO_PROXY_COUNTRY_INVALID');
  if (city.length > 300 || region.length > 300 || regionCode.length > 60) return fail('GEO_PROXY_LOCATION_INVALID');
  if (!['cloudflare','unavailable'].includes(geoProvider)) return fail('GEO_PROXY_PROVIDER_INVALID');
  const signatureBytes = hexToBytes(signature);
  if (!signatureBytes) return fail('GEO_PROXY_SIGNATURE_INVALID');

  let requestBytes: Uint8Array;
  try {
    requestBytes = request.body ? new Uint8Array(await request.clone().arrayBuffer()) : new Uint8Array();
  } catch {
    return fail('GEO_PROXY_BODY_UNREADABLE');
  }
  if (requestBytes.byteLength > 8192) return fail('GEO_PROXY_BODY_TOO_LARGE');
  const bodyHash = await sha256Hex(requestBytes);
  if (bodyHash !== suppliedBodyHash) return fail('GEO_PROXY_BODY_MISMATCH');

  const origin = request.headers.get('origin') ?? '';
  const message = canonicalPayload({
    timestamp, nonce, method: request.method, route, origin, bodyHash, ip,
    country, city, region, regionCode, geoProvider,
  });

  try {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
    );
    const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, new TextEncoder().encode(message));
    if (!valid) return fail('GEO_PROXY_SIGNATURE_INVALID');
  } catch {
    return fail('GEO_PROXY_SIGNATURE_CHECK_FAILED');
  }

  // A valid HMAC alone can be replayed inside the timestamp window. Consume
  // the nonce atomically in PostgreSQL after signature verification. A missing
  // or unavailable nonce store fails closed for every signed Worker request.
  if (!consumeNonce) return fail('GEO_PROXY_NONCE_CONSUMER_UNAVAILABLE');
  try {
    const consumed = await consumeNonce(nonce, timestamp);
    if (!consumed) return fail('GEO_PROXY_NONCE_REPLAYED_OR_EXPIRED');
  } catch {
    return fail('GEO_PROXY_NONCE_STORE_UNAVAILABLE');
  }

  return {
    ok: true,
    ip,
    location: {
      countryCode: country || null,
      city: decodeLocation(city, 100),
      region: decodeLocation(region, 100),
      regionCode: decodeLocation(regionCode, 20),
    },
    proxyVerified: true,
    source: 'cloudflare-worker',
    geoProvider,
  };
}

/**
 * Resolve a trusted visitor for a specific Worker route. The route binding
 * prevents a valid signature for one endpoint being reused at another.
 */
export type GeoNonceConsumer = (nonce: string, timestamp: string) => Promise<boolean>;

export async function resolveTrustedVisitor(
  request: Request,
  expectedRoute: string,
  consumeNonce?: GeoNonceConsumer,
): Promise<TrustedVisitor> {
  const proxyMarker = request.headers.get('x-hostel-geo-proxy');
  if (proxyMarker === 'v1') {
    return await verifyProxyRequest(request, expectedRoute, consumeNonce);
  }

  // Direct-to-Supabase is the supported baseline; an optional Worker outage
  // can never lock users out of Authentication.
  // City/Region are omitted on this path; only ingress-provided IP/Country are used.
  const ip = validIp(request.headers.get('cf-connecting-ip'));
  const countryHeader = request.headers.get('cf-ipcountry')?.trim().toUpperCase() ?? '';
  return {
    ok: Boolean(ip),
    ip,
    location: {
      countryCode: /^[A-Z]{2}$/.test(countryHeader) && countryHeader !== 'XX' ? countryHeader : null,
      city: null,
      region: null,
      regionCode: null,
    },
    proxyVerified: false,
    source: ip ? 'supabase-edge' : 'unavailable',
    geoProvider: null,
    ...(!ip ? { code: 'CLIENT_IP_UNAVAILABLE' } : {}),
  };
}
