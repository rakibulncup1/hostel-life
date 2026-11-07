// First-party app-flow gate for repeated failed login/signup attempts.
// This checks the trusted Cloudflare ingress IP before calling Supabase Auth.
// It does not proxy GoTrue; direct requests to the public Auth endpoint may bypass it.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { resolveTrustedVisitor } from '../_shared/geoProxy.ts';

const VERSION = '2026-11-07-auth-security-gate-4-signed-geo-nonce';
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
  // Prefer the current named secret key; keep legacy compatibility during migration.
  try {
    const parsed = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    if (typeof parsed?.default === 'string' && parsed.default.trim()) return parsed.default.trim();
  } catch { /* Fall through to the legacy key. */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() ?? '';
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

  if (request.method === 'GET') {
    // Check this request's trusted ingress IP. A NULL probe deliberately reports
    // protection_available=false, so using it here would make every healthy gate
    // appear unavailable in the Super Admin health panel.
    const visitor = await resolveTrustedVisitor(request, 'auth-security-gate', consumeGeoNonce);
    if (!visitor.ok || !visitor.ip) {
      return respond({ ready: false, database_rpc_ready: false, client_ip_available: false, protection_available: false, code: visitor.code || 'CLIENT_IP_UNAVAILABLE', geo_proxy_verified: false, request_id: requestId, version: VERSION }, 503, origin, origins);
    }
    const { data, error } = await admin.rpc('hl_check_auth_ip_block', { p_request_ip: visitor.ip });
    if (error) return respond({ ready: false, database_rpc_ready: false, code: 'AUTH_GATE_RPC_UNAVAILABLE', request_id: requestId, version: VERSION }, 503, origin, origins);
    const clientIpAvailable = Boolean(visitor.ip);
    const protectionAvailable = clientIpAvailable && data?.protection_available === true;
    return respond({
      ready: true,
      database_rpc_ready: true,
      client_ip_available: clientIpAvailable,
      protection_available: protectionAvailable,
      blocked: data?.blocked === true,
      retry_at: data?.blocked_until || null,
      geo_proxy_verified: visitor.proxyVerified,
      geo_source: visitor.source,
      city_header_available: Boolean(visitor.location.city),
      region_header_available: Boolean(visitor.location.region),
      country_header_available: Boolean(visitor.location.countryCode),
      version: VERSION,
    }, 200, origin, origins);
  }
  const visitor = await resolveTrustedVisitor(request, 'auth-security-gate', consumeGeoNonce);
  const ip = visitor.ip;
  if (!visitor.ok || !ip) return respond({ allowed: false, protection_available: false, code: visitor.code || 'CLIENT_IP_UNAVAILABLE', message: 'নিরাপত্তা যাচাইয়ের জন্য নির্ভরযোগ্য Client IP পাওয়া যায়নি। কিছুক্ষণ পরে আবার চেষ্টা করুন।', request_id: requestId, version: VERSION }, 503, origin, origins);
  const { data, error } = await admin.rpc('hl_check_auth_ip_block', { p_request_ip: ip });
  if (error) {
    console.error('auth-security-gate database lookup failed', { request_id: requestId, code: error.code, message: error.message });
    return respond({ code: 'AUTH_GATE_LOOKUP_FAILED', request_id: requestId, version: VERSION }, 503, origin, origins);
  }
  if (data?.blocked) {
    const retryAt = typeof data.blocked_until === 'string' ? data.blocked_until : null;
    const seconds = Math.max(1, Number(data.retry_after_seconds) || 900);
    return respond({ blocked: true, code: 'AUTH_IP_TEMPORARILY_BLOCKED',
      message: 'এই নেটওয়ার্ক থেকে এক মিনিটে ৫টির বেশি ব্যর্থ Login/Registration প্রচেষ্টা হয়েছে। নিরাপত্তার জন্য ১৫ মিনিটের জন্য Login ও Registration সাময়িকভাবে বন্ধ রাখা হয়েছে।',
      retry_at: retryAt, retry_after_seconds: seconds, request_id: requestId, version: VERSION }, 429, origin, origins);
  }
  return respond({ allowed: true, protection_available: data?.protection_available !== false, request_id: requestId, version: VERSION }, 200, origin, origins);
});
