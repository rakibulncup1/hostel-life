// Public, telemetry-only endpoint for application-originated login/registration
// attempts. It never authenticates a user, blocks login, or receives a password.
// Deploy with verify_jwt=false; service-role access remains server-only.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { resolveTrustedVisitor } from '../_shared/geoProxy.ts';

const VERSION = '2026-11-06-auth-security-telemetry-6-signed-geo';
const DEFAULT_ALLOWED_ORIGINS = [
  'https://hostellife-bd.vercel.app',
  'https://easy-hostellife.vercel.app',
  'http://localhost:5173',
];
const ALLOWED_EVENTS = new Set([
  'login_failed', 'login_success', 'signup_failed', 'signup_submitted', 'password_reset_failed', 'password_reset_requested',
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

function serviceRoleKey(): string {
  // Prefer Supabase's current named secret key; retain legacy fallback during transition.
  try {
    const parsed = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    if (typeof parsed?.default === 'string' && parsed.default.trim()) return parsed.default.trim();
  } catch { /* Fall through to the legacy key. */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() ?? '';
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
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  return new Response(JSON.stringify(body), { status, headers });
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
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Cache-Control': 'no-store',
      'Vary': 'Origin',
    }});
  }
  if (!['GET', 'POST'].includes(request.method)) {
    return response({ code: 'METHOD_NOT_ALLOWED', request_id: requestId }, 405, origin, origins);
  }
  if (!origin || !origins.includes(normalizedOrigin)) {
    return response({ code: 'ORIGIN_NOT_ALLOWED', request_id: requestId }, 403, origin, origins);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const adminKey = serviceRoleKey();
  // A dedicated stable HMAC secret is preferred. The server-only Supabase key
  // is a safe fallback so telemetry does not silently stay empty when the
  // optional custom secret has not yet been configured.
  const configuredHmacSecret = Deno.env.get('HOSTEL_SECURITY_HMAC_SECRET')?.trim() ?? '';
  const hmacSecret = configuredHmacSecret || adminKey;
  if (!supabaseUrl || !adminKey || hmacSecret.length < 32) {
    console.error('record-auth-event configuration missing', {
      request_id: requestId,
      has_url: Boolean(supabaseUrl),
      has_server_key: Boolean(adminKey),
      has_hmac_key: hmacSecret.length >= 32,
    });
    // Telemetry failure must never interfere with the actual Supabase Auth flow.
    return response({ accepted: false, code: 'TELEMETRY_NOT_CONFIGURED', request_id: requestId }, 503, origin, origins);
  }

  const admin = createClient(supabaseUrl, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const visitor = await resolveTrustedVisitor(request, 'record-auth-event');
  if (!visitor.ok) {
    return response({ accepted: false, ready: false, code: visitor.code || 'CLIENT_IP_UNAVAILABLE', request_id: requestId, version: VERSION }, 503, origin, origins);
  }

  // Read-only health check. The deliberately invalid event type is rejected
  // by Run36 with SQLSTATE 22023 before any insert; that proves the geo-aware v3 RPC exists
  // and is callable without creating a synthetic Security Event.
  if (request.method === 'GET') {
    try {
      const location = visitor.location;
      const { error } = await admin.rpc('hl_record_public_security_event_v3', {
        p_event_type: '__hostel_life_health_check__',
        p_identity_fingerprint: null,
        p_ip_fingerprint: null,
        p_request_ip: visitor.ip,
        p_failure_code: null,
        p_user_agent: null,
        p_request_origin: normalizedOrigin,
        p_country_code: location.countryCode,
        p_city: location.city,
        p_region: location.region,
        p_region_code: location.regionCode,
      });
      if (error?.code === '22023') {
        return response({ ready: true, database_rpc_ready: true, client_ip_available: Boolean(visitor.ip), geo_proxy_verified: visitor.proxyVerified, geo_source: visitor.source, city_header_available: Boolean(location.city), region_header_available: Boolean(location.region), country_header_available: Boolean(location.countryCode), version: VERSION }, 200, origin, origins);
      }
      const rpcMissing = error?.code === '42883' || error?.code === 'PGRST202' || /could not find the function|function .* does not exist/i.test(error?.message ?? '');
      const code = rpcMissing ? 'TELEMETRY_RPC_MISSING' : 'TELEMETRY_DATABASE_UNAVAILABLE';
      return response({ ready: false, code, version: VERSION }, 503, origin, origins);
    } catch (error) {
      console.error('record-auth-event health check failed', { request_id: requestId, message: String(error) });
      return response({ ready: false, code: 'TELEMETRY_HEALTH_CHECK_FAILED', version: VERSION }, 503, origin, origins);
    }
  }

  if (request.method !== 'POST') {
    return response({ code: 'METHOD_NOT_ALLOWED', request_id: requestId }, 405, origin, origins);
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
  const ip = visitor.ip;
  const ipFingerprint = ip ? await hmacFingerprint(`ip:${ip}`, hmacSecret) : null;
  const failureCode = typeof body.failure_code === 'string' && ALLOWED_FAILURE_CODES.has(body.failure_code)
    ? body.failure_code : null;
  const location = visitor.location;

  try {
    const { data, error } = await admin.rpc('hl_record_public_security_event_v3', {
      p_event_type: eventType,
      p_identity_fingerprint: identityFingerprint,
      p_ip_fingerprint: ipFingerprint,
      p_request_ip: ip,
      p_failure_code: failureCode,
      p_user_agent: request.headers.get('user-agent')?.slice(0, 512) ?? null,
      p_request_origin: normalizedOrigin,
      p_country_code: location.countryCode,
      p_city: location.city,
      p_region: location.region,
      p_region_code: location.regionCode,
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
