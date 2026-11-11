// Optional first-party abuse guard for repeated failures on one (trusted IP + email) pair.
// Direct requests to the public Auth endpoint may bypass this app pre-check;
// Supabase Auth remains the primary boundary and native rate limits stay enabled.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { resolveTrustedVisitor } from '../_shared/geoProxy.ts';

const VERSION = '2026-11-11-auth-security-gate-5-email-ip-pair-optional-worker';
const DEFAULT_ALLOWED_ORIGINS = [
  'https://hostellife-bd.vercel.app',
  'https://easy-hostellife.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

function allowedOrigins(): string[] {
  const configured = Deno.env.get('HOSTEL_SECURITY_ALLOWED_ORIGINS');
  const values = configured ? configured.split(',').map((value) => value.trim()).filter(Boolean) : DEFAULT_ALLOWED_ORIGINS;
  return [...new Set(values.map((value) => value.replace(/\/$/, '')))];
}
function serverKey(): string {
  try {
    const parsed = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    if (typeof parsed?.default === 'string' && parsed.default.trim()) return parsed.default.trim();
  } catch { /* Legacy key below. */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() ?? '';
}
function normalizedEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length >= 5 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
async function fingerprintIdentity(email: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`identity:${email}`));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function respond(body: Record<string, unknown>, status: number, origin: string, origins: string[]): Response {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin' });
  if (origin && origins.includes(origin.replace(/\/$/, ''))) headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  const origin = request.headers.get('Origin') ?? '';
  const origins = allowedOrigins();
  const normalizedOrigin = origin.replace(/\/$/, '');
  if (request.method === 'OPTIONS') {
    if (!origin || !origins.includes(normalizedOrigin)) return respond({ code: 'ORIGIN_NOT_ALLOWED', request_id: requestId }, 403, origin, origins);
    return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Cache-Control': 'no-store', Vary: 'Origin',
    }});
  }
  if (!['GET', 'POST'].includes(request.method)) return respond({ code: 'METHOD_NOT_ALLOWED', request_id: requestId }, 405, origin, origins);
  if (!origin || !origins.includes(normalizedOrigin)) return respond({ code: 'ORIGIN_NOT_ALLOWED', request_id: requestId }, 403, origin, origins);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = serverKey();
  if (!url || !key) return respond({ code: 'SERVER_CONFIGURATION_MISSING', request_id: requestId }, 503, origin, origins);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const configuredHmac = Deno.env.get('HOSTEL_SECURITY_HMAC_SECRET')?.trim() ?? '';
  const hmacSecret = configuredHmac || key;
  if (hmacSecret.length < 32) return respond({ code: 'SECURITY_FINGERPRINT_KEY_UNAVAILABLE', request_id: requestId }, 503, origin, origins);
  const consumeGeoNonce = async (nonce: string, timestamp: string): Promise<boolean> => {
    const { data, error } = await admin.rpc('hl_consume_geo_proxy_nonce', {
      p_nonce: nonce, p_issued_at: new Date(Number(timestamp)).toISOString(),
    });
    if (error) {
      console.error('auth-security-gate geo nonce store failed', { request_id: requestId, code: error.code });
      return false;
    }
    return data === true;
  };
  const visitor = await resolveTrustedVisitor(request, 'auth-security-gate', consumeGeoNonce);
  if (!visitor.ok && visitor.code !== 'CLIENT_IP_UNAVAILABLE') {
    return respond({ code: visitor.code || 'GEO_PROXY_INVALID', request_id: requestId, version: VERSION }, 503, origin, origins);
  }
  const ip = visitor.ok ? visitor.ip : null;

  if (request.method === 'GET') {
    let globalBlock = { blocked: false, protection_available: Boolean(ip) };
    if (ip) {
      const result = await admin.rpc('hl_check_auth_ip_block_v2', { p_request_ip: ip, p_email_fingerprint: null });
      if (result.error) return respond({ ready: false, database_rpc_ready: false, code: 'AUTH_GATE_RPC_UNAVAILABLE', request_id: requestId, version: VERSION }, 503, origin, origins);
      globalBlock = result.data || globalBlock;
    }
    return respond({
      ready: true, database_rpc_ready: true, client_ip_available: Boolean(ip),
      protection_available: Boolean(ip) && globalBlock.protection_available === true,
      blocked: globalBlock.blocked === true,
      retry_at: globalBlock.blocked_until || null,
      geo_proxy_verified: visitor.proxyVerified,
      geo_source: visitor.source,
      geo_provider: visitor.geoProvider || null,
      country_header_available: Boolean(visitor.location.countryCode),
      city_header_available: Boolean(visitor.location.city),
      region_header_available: Boolean(visitor.location.region),
      version: VERSION,
    }, 200, origin, origins);
  }

  let body: { email?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > 2048) return respond({ code: 'REQUEST_TOO_LARGE', request_id: requestId }, 413, origin, origins);
    body = JSON.parse(raw);
  } catch {
    return respond({ code: 'INVALID_REQUEST', request_id: requestId }, 400, origin, origins);
  }
  const email = normalizedEmail(body.email);
  if (!email) return respond({ code: 'INVALID_EMAIL', message: 'সঠিক ইমেইল ঠিকানা দিন।', request_id: requestId }, 400, origin, origins);

  // An unavailable IP disables only this extra pair check. Supabase Auth's own
  // IP and per-user protections continue to apply.
  if (!ip) return respond({ allowed: true, protection_available: false, reason: 'client_ip_unavailable', request_id: requestId, version: VERSION }, 200, origin, origins);
  const identityFingerprint = await fingerprintIdentity(email, hmacSecret);
  const { data, error } = await admin.rpc('hl_check_auth_ip_block_v2', {
    p_request_ip: ip,
    p_email_fingerprint: identityFingerprint,
  });
  if (error) {
    console.error('auth-security-gate database lookup failed', { request_id: requestId, code: error.code });
    return respond({ code: 'AUTH_GATE_LOOKUP_FAILED', request_id: requestId, version: VERSION }, 503, origin, origins);
  }
  if (data?.blocked) {
    const retryAt = typeof data.blocked_until === 'string' ? data.blocked_until : null;
    const seconds = Math.max(1, Number(data.retry_after_seconds) || 900);
    return respond({ blocked: true, code: 'AUTH_IP_TEMPORARILY_BLOCKED',
      message: 'এই ইমেইল ঠিকানা থেকে এই নেটওয়ার্কে এক মিনিটে ৬টি ব্যর্থ Login/Registration প্রচেষ্টা হয়েছে। নিরাপত্তার জন্য ১৫ মিনিট অপেক্ষা করুন।',
      retry_at: retryAt, retry_after_seconds: seconds, request_id: requestId, version: VERSION }, 429, origin, origins);
  }
  return respond({ allowed: true, protection_available: data?.protection_available !== false, request_id: requestId, version: VERSION }, 200, origin, origins);
});
