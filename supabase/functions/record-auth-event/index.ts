// Public, telemetry-only endpoint for application-originated login/registration
// attempts. It never receives a password or enforces the Auth login. For a success event
// it independently validates the caller JWT before attaching the account identity.
// Deploy with verify_jwt=false; service-role access remains server-only.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { resolveTrustedVisitor } from '../_shared/geoProxy.ts';

const VERSION = '2026-11-08-auth-security-telemetry-10-attempt-email-and-signup-verification';
const DEFAULT_ALLOWED_ORIGINS = [
  'https://hostellife-bd.vercel.app',
  'https://easy-hostellife.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];
const AUTHENTICATED_EVENT_TYPES = new Set(['login_success', 'signup_verified']);
const PUBLIC_EVENT_TYPES = new Set([
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

// The bearer token is first verified with Supabase Auth below. Only then do we
// read its signed session_id claim for the Run37 active-session guard.
function sessionIdFromJwtPayload(jwt: string): string | null {
  try {
    const segment = jwt.split('.')[1];
    if (!segment) return null;
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(segment.length / 4) * 4, '=');
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    const sessionId = typeof payload?.session_id === 'string' ? payload.session_id : '';
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)
      ? sessionId : null;
  } catch {
    return null;
  }
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
  const consumeGeoNonce = async (nonce: string, timestamp: string): Promise<boolean> => {
    const { data, error } = await admin.rpc('hl_consume_geo_proxy_nonce', {
      p_nonce: nonce, p_issued_at: new Date(Number(timestamp)).toISOString(),
    });
    if (error) {
      console.error('record-auth-event geo nonce store failed', { request_id: requestId, code: error.code });
      return false;
    }
    return data === true;
  };
  const visitor = await resolveTrustedVisitor(request, 'record-auth-event', consumeGeoNonce);
  const noTrustedIpFallback = !visitor.ok && ['CLIENT_IP_UNAVAILABLE'].includes(visitor.code || '');
  // Health checks must prove that the signed proxy supplies a real visitor IP.
  // POST telemetry may still store the attempted email with a NULL IP if the
  // proxy is missing, but never accepts invalid/replayed signatures.
  if (!visitor.ok && !noTrustedIpFallback) {
    return response({ accepted: false, ready: false, code: visitor.code || 'CLIENT_IP_UNAVAILABLE', request_id: requestId, version: VERSION }, 503, origin, origins);
  }
  // Location collection is disabled. Keep the database writer contract
  // backward-compatible while sending NULL for every geo column.
  const location = { countryCode: null, city: null, region: null, regionCode: null };

  // Read-only health RPC: no synthetic events and no intentional SQL errors
  // are generated when the Super Admin opens the monitor.
  if (request.method === 'GET') {
    try {
      const { data: health, error } = await admin.rpc('hl_security_monitor_writer_health_v1');
      if (error || !health?.telemetry_writer_ready || !health?.event_table_ready) {
        const rpcMissing = error?.code === '42883' || error?.code === 'PGRST202' || /could not find the function|function .* does not exist/i.test(error?.message ?? '');
        const code = rpcMissing ? 'TELEMETRY_HEALTH_RPC_MISSING' : 'TELEMETRY_DATABASE_UNAVAILABLE';
        return response({ ready: false, code, authenticated_login_writer_ready: Boolean(health?.authenticated_login_writer_ready), attempt_email_column_ready: Boolean(health?.attempt_email_column_ready), version: VERSION }, 503, origin, origins);
      }
      return response({
        ready: true,
        database_rpc_ready: true,
        authenticated_login_writer_ready: Boolean(health?.authenticated_login_writer_ready && health?.actor_column_ready),
        attempt_email_column_ready: Boolean(health?.attempt_email_column_ready),
        client_ip_available: Boolean(visitor.ip),
        geo_proxy_verified: visitor.proxyVerified,
        geo_source: visitor.source,
        geo_provider: visitor.geoProvider || null,
        location_collection_enabled: false,
        version: VERSION,
      }, 200, origin, origins);
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
  const ip = visitor.ok ? visitor.ip : null;
  const ipFingerprint = ip ? await hmacFingerprint(`ip:${ip}`, hmacSecret) : null;

  // A successful login must be tied to a real Supabase Auth identity. The
  // endpoint remains JWT-disabled for failed/pre-auth events, but this branch
  // independently verifies the supplied access token with Supabase Auth.
  if (AUTHENTICATED_EVENT_TYPES.has(eventType)) {
    const authorization = request.headers.get('authorization') ?? '';
    const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
    if (!tokenMatch?.[1]) {
      return response({ accepted: false, code: 'AUTHENTICATED_LOGIN_TOKEN_REQUIRED', request_id: requestId, version: VERSION }, 401, origin, origins);
    }
    const jwt = tokenMatch[1];
    const { data: authData, error: authError } = await admin.auth.getUser(jwt);
    const verifiedUser = authData?.user;
    const verifiedSessionId = !authError && verifiedUser?.id ? sessionIdFromJwtPayload(jwt) : null;
    if (authError || !verifiedUser?.id || !verifiedUser.email || !verifiedSessionId || (eventType === 'signup_verified' && !verifiedUser.email_confirmed_at)) {
      return response({ accepted: false, code: 'AUTHENTICATED_LOGIN_IDENTITY_INVALID', request_id: requestId, version: VERSION }, 401, origin, origins);
    }
    // Defense in depth: explicitly check the signed session_id against the
    // existing Run37 auth.sessions guard before writing the event. The SQL
    // writer repeats this check in the same transaction to avoid a race.
    const { data: activeSession, error: sessionCheckError } = await admin.rpc('hl_is_auth_session_active_for_security_event', {
      p_user_id: verifiedUser.id,
      p_session_id: verifiedSessionId,
    });
    if (sessionCheckError || activeSession !== true) {
      return response({ accepted: false, code: 'AUTH_SESSION_NOT_ACTIVE', request_id: requestId, version: VERSION }, 401, origin, origins);
    }
    const identityFingerprint = await hmacFingerprint(`identity:${verifiedUser.email.trim().toLowerCase()}`, hmacSecret);
    try {
      const { data, error } = await admin.rpc('hl_record_authenticated_auth_event_v2', {
        p_event_type: eventType,
        p_actor_user_id: verifiedUser.id,
        p_session_id: verifiedSessionId,
        p_attempt_email: verifiedUser.email,
        p_identity_fingerprint: identityFingerprint,
        p_ip_fingerprint: ipFingerprint,
        p_request_ip: ip,
        p_user_agent: request.headers.get('user-agent')?.slice(0, 512) ?? null,
        p_request_origin: normalizedOrigin,
        p_country_code: location.countryCode,
        p_city: location.city,
        p_region: location.region,
        p_region_code: location.regionCode,
      });
      if (error) {
        console.error('record-auth-event verified login write failed', { request_id: requestId, code: error.code, message: error.message });
        return response({ accepted: false, code: 'AUTHENTICATED_LOGIN_WRITE_FAILED', request_id: requestId, version: VERSION }, 503, origin, origins);
      }
      return response({ accepted: Boolean((data as { accepted?: boolean } | null)?.accepted), request_id: requestId, version: VERSION }, 200, origin, origins);
    } catch (error) {
      console.error('record-auth-event verified login unexpected error', { request_id: requestId, message: String(error) });
      return response({ accepted: false, code: 'AUTHENTICATED_LOGIN_FAILED', request_id: requestId, version: VERSION }, 503, origin, origins);
    }
  }

  if (!PUBLIC_EVENT_TYPES.has(eventType)) {
    return response({ accepted: false, code: 'EVENT_NOT_ALLOWED', request_id: requestId }, 400, origin, origins);
  }
  const email = normalizeEmail(body.email);
  const identityFingerprint = email ? await hmacFingerprint(`identity:${email}`, hmacSecret) : null;
  const failureCode = typeof body.failure_code === 'string' && ALLOWED_FAILURE_CODES.has(body.failure_code)
    ? body.failure_code : (!ip ? (visitor.code || 'trusted_ip_unavailable') : null);

  try {
    const { data, error } = await admin.rpc('hl_record_public_security_event_v5', {
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
      p_attempt_email: email,
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
