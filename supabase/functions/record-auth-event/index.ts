// Public, telemetry-only endpoint for application-originated login/registration
// attempts. It never authenticates a user, blocks login, or receives a password.
// Deploy with verify_jwt=false; service-role access remains server-only.
import { createClient } from 'npm:@supabase/supabase-js@2';

const VERSION = '2026-11-02-auth-security-telemetry-1';
const DEFAULT_ALLOWED_ORIGINS = [
  'https://hostellife-bd.vercel.app',
  'https://easy-hostellife.vercel.app',
  'http://localhost:5173',
];
const ALLOWED_EVENTS = new Set([
  'login_failed', 'signup_failed', 'signup_submitted', 'password_reset_failed',
]);
const ALLOWED_FAILURE_CODES = new Set([
  'invalid_credentials', 'rate_limited', 'account_exists', 'signup_disabled', 'other',
]);

function allowedOrigins(): string[] {
  const configured = Deno.env.get('HOSTEL_SECURITY_ALLOWED_ORIGINS');
  const values = configured
    ? configured.split(',').map((value) => value.trim()).filter(Boolean)
    : DEFAULT_ALLOWED_ORIGINS;
  return [...new Set(values.map((value) => value.replace(/\/$/, '')))];
}

function response(body: Record<string, unknown>, status: number, origin: string, origins: string[]): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  });
  if (origin && origins.includes(origin.replace(/\/$/, ''))) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  headers.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  return new Response(JSON.stringify(body), { status, headers });
}

function isIpv4(value: string): boolean {
  const pieces = value.split('.');
  return pieces.length === 4 && pieces.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isIpv6(value: string): boolean {
  if (!value.includes(':') || !/^[0-9a-fA-F:.]+$/.test(value)) return false;
  if (value.includes(':::')) return false;
  const doubleColonCount = (value.match(/::/g) ?? []).length;
  if (doubleColonCount > 1) return false;
  const doubleColon = doubleColonCount === 1;
  const pieces = value.split(':');
  const nonEmpty = pieces.filter(Boolean);
  const ipv4Tail = nonEmpty.length > 0 && nonEmpty[nonEmpty.length - 1].includes('.');
  if (ipv4Tail) {
    if (!isIpv4(nonEmpty[nonEmpty.length - 1])) return false;
    nonEmpty[nonEmpty.length - 1] = 'ipv4';
  }
  const groups = nonEmpty.reduce((count, item) => count + (item === 'ipv4' ? 2 : 1), 0);
  return doubleColon ? groups < 8 : groups === 8;
}

function trustedProxyIp(request: Request): string | null {
  // Supabase Edge Functions run behind Cloudflare. Use only its ingress header;
  // generic forwarding headers may be supplied by a caller and are not trusted.
  const ip = request.headers.get('cf-connecting-ip')?.trim() ?? '';
  if (!ip || ip.length > 45 || !(isIpv4(ip) || isIpv6(ip))) return null;
  return ip;
}

async function hmacFingerprint(value: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length >= 5 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email : null;
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  const origin = request.headers.get('Origin') ?? '';
  const origins = allowedOrigins();
  const normalizedOrigin = origin.replace(/\/$/, '');

  if (request.method === 'OPTIONS') {
    if (!origin || !origins.includes(normalizedOrigin)) {
      return response({ code: 'ORIGIN_NOT_ALLOWED', request_id: requestId }, 403, origin, origins);
    }
    return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Cache-Control': 'no-store',
      'Vary': 'Origin',
    }});
  }
  if (request.method !== 'POST') {
    return response({ code: 'METHOD_NOT_ALLOWED', request_id: requestId }, 405, origin, origins);
  }
  if (!origin || !origins.includes(normalizedOrigin)) {
    return response({ code: 'ORIGIN_NOT_ALLOWED', request_id: requestId }, 403, origin, origins);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const hmacSecret = Deno.env.get('HOSTEL_SECURITY_HMAC_SECRET') ?? '';
  if (!supabaseUrl || !serviceRoleKey || hmacSecret.length < 32) {
    console.error('record-auth-event configuration missing', {
      request_id: requestId,
      has_url: Boolean(supabaseUrl),
      has_service_role_key: Boolean(serviceRoleKey),
      has_hmac_secret: hmacSecret.length >= 32,
    });
    // Telemetry failure must never interfere with the actual Supabase Auth flow.
    return response({ accepted: false, code: 'TELEMETRY_NOT_CONFIGURED', request_id: requestId }, 503, origin, origins);
  }

  let body: { event_type?: unknown; email?: unknown; failure_code?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > 2048) return response({ accepted: false, code: 'REQUEST_TOO_LARGE', request_id: requestId }, 413, origin, origins);
    body = JSON.parse(raw);
  } catch {
    return response({ accepted: false, code: 'INVALID_REQUEST', request_id: requestId }, 400, origin, origins);
  }

  const eventType = typeof body.event_type === 'string' ? body.event_type : '';
  if (!ALLOWED_EVENTS.has(eventType)) {
    return response({ accepted: false, code: 'EVENT_NOT_ALLOWED', request_id: requestId }, 400, origin, origins);
  }
  const email = normalizeEmail(body.email);
  const identityFingerprint = email ? await hmacFingerprint(`identity:${email}`, hmacSecret) : null;
  const ip = trustedProxyIp(request);
  const ipFingerprint = ip ? await hmacFingerprint(`ip:${ip}`, hmacSecret) : null;
  const failureCode = typeof body.failure_code === 'string' && ALLOWED_FAILURE_CODES.has(body.failure_code)
    ? body.failure_code : null;

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  try {
    const { data, error } = await admin.rpc('hl_record_public_security_event', {
      p_event_type: eventType,
      p_identity_fingerprint: identityFingerprint,
      p_ip_fingerprint: ipFingerprint,
      p_request_ip: ip,
      p_failure_code: failureCode,
      p_user_agent: request.headers.get('user-agent')?.slice(0, 512) ?? null,
      p_request_origin: normalizedOrigin,
    });
    if (error) {
      console.error('record-auth-event database write failed', {
        request_id: requestId, code: error.code, message: error.message,
      });
      return response({ accepted: false, code: 'TELEMETRY_WRITE_FAILED', request_id: requestId, version: VERSION }, 503, origin, origins);
    }
    return response({ accepted: Boolean((data as { accepted?: boolean } | null)?.accepted), request_id: requestId, version: VERSION }, 200, origin, origins);
  } catch (error) {
    console.error('record-auth-event unexpected error', { request_id: requestId, message: String(error) });
    return response({ accepted: false, code: 'TELEMETRY_FAILED', request_id: requestId, version: VERSION }, 503, origin, origins);
  }
});
