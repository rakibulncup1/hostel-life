// First-party app-flow gate for repeated failed login/signup attempts.
// This checks the trusted Cloudflare ingress IP before calling Supabase Auth.
// It does not proxy GoTrue; direct requests to the public Auth endpoint may bypass it.
import { createClient } from 'npm:@supabase/supabase-js@2';

const VERSION = '2026-11-06-auth-security-gate-1';
const DEFAULT_ALLOWED_ORIGINS = [
  'https://hostellife-bd.vercel.app',
  'https://easy-hostellife.vercel.app',
  'http://localhost:5173',
];

function allowedOrigins(): string[] {
  const configured = Deno.env.get('HOSTEL_SECURITY_ALLOWED_ORIGINS');
  const values = configured ? configured.split(',').map((value) => value.trim()).filter(Boolean) : DEFAULT_ALLOWED_ORIGINS;
  return [...new Set(values.map((value) => value.replace(/\/$/, '')))];
}
function serverKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() ?? '';
  if (legacy) return legacy;
  try {
    const parsed = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    return typeof parsed?.default === 'string' ? parsed.default.trim() : '';
  } catch { return ''; }
}
function validIpv4(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
function validIpv6(value: string): boolean {
  if (!value.includes(':') || value.length > 45 || value.includes(':::')) return false;
  let normalized = value;
  if (value.includes('.')) {
    const separator = value.lastIndexOf(':');
    if (separator < 0 || !validIpv4(value.slice(separator + 1))) return false;
    normalized = `${value.slice(0, separator)}:ipv4`;
  }
  if (!/^[0-9a-fA-F:]+$/.test(normalized.replace('ipv4', 'a'))) return false;
  const compressedParts = normalized.split('::');
  if (compressedParts.length > 2) return false;
  const parseSide = (side: string): number | null => {
    if (!side) return 0;
    const groups = side.split(':');
    let count = 0;
    for (const group of groups) {
      if (group === 'ipv4') count += 2;
      else if (/^[0-9a-fA-F]{1,4}$/.test(group)) count += 1;
      else return null;
    }
    return count;
  };
  const left = parseSide(compressedParts[0]);
  const right = compressedParts.length === 2 ? parseSide(compressedParts[1]) : 0;
  if (left === null || right === null) return false;
  const groups = left + right;
  return compressedParts.length === 2 ? groups < 8 : groups === 8;
}
function trustedProxyIp(request: Request): string | null {
  // Never trust X-Forwarded-For or a browser-supplied IP field.
  const ip = request.headers.get('cf-connecting-ip')?.trim() ?? '';
  return (validIpv4(ip) || validIpv6(ip)) ? ip : null;
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

  if (request.method === 'GET') {
    // Check this request's trusted ingress IP. A NULL probe deliberately reports
    // protection_available=false, so using it here would make every healthy gate
    // appear unavailable in the Super Admin health panel.
    const healthIp = trustedProxyIp(request);
    const { data, error } = await admin.rpc('hl_check_auth_ip_block', { p_request_ip: healthIp });
    if (error) return respond({ ready: false, database_rpc_ready: false, code: 'AUTH_GATE_RPC_UNAVAILABLE', request_id: requestId, version: VERSION }, 503, origin, origins);
    const clientIpAvailable = Boolean(healthIp);
    const protectionAvailable = clientIpAvailable && data?.protection_available === true;
    return respond({
      ready: true,
      database_rpc_ready: true,
      client_ip_available: clientIpAvailable,
      protection_available: protectionAvailable,
      blocked: data?.blocked === true,
      retry_at: data?.blocked_until || null,
      version: VERSION,
    }, 200, origin, origins);
  }
  const ip = trustedProxyIp(request);
  if (!ip) return respond({ allowed: false, protection_available: false, code: 'CLIENT_IP_UNAVAILABLE', message: 'নিরাপত্তা যাচাইয়ের জন্য নির্ভরযোগ্য Client IP পাওয়া যায়নি। কিছুক্ষণ পরে আবার চেষ্টা করুন।', request_id: requestId, version: VERSION }, 503, origin, origins);
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
