// Public recovery entry point. Deploy with JWT verification disabled because
// users are not authenticated when requesting a password-reset email.
// The function itself enforces an HMAC-keyed email quota before calling Auth.
// Never expose SUPABASE_SERVICE_ROLE_KEY or PASSWORD_RESET_HMAC_SECRET to clients.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { resolveTrustedVisitor } from '../_shared/geoProxy.ts';

const FUNCTION_VERSION = '2026-11-08-password-reset-quota-and-ip-gate-8-signed-geo-nonce-attempt-email';
const DEFAULT_ALLOWED_ORIGINS = [
  'https://hostellife-bd.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://easy-hostellife.vercel.app',

];

type QuotaResult = {
  allowed?: boolean;
  reason?: 'daily_limit' | 'monthly_limit';
  request_id?: string;
  retry_at?: string;
  daily_remaining?: number;
  monthly_remaining?: number;
};

function defaultApiKey(mapName: string): string {
  const raw = Deno.env.get(mapName)?.trim() ?? '';
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    const value = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).default : null;
    return typeof value === 'string' ? value.trim() : '';
  } catch {
    return '';
  }
}

function publishableKey(): string {
  // Prefer the current named publishable key; retain the legacy fallback during migration.
  return defaultApiKey('SUPABASE_PUBLISHABLE_KEYS') || Deno.env.get('SUPABASE_ANON_KEY')?.trim() || '';
}

function secretKey(): string {
  // Secret keys bypass RLS and must remain inside this Edge Function only.
  return defaultApiKey('SUPABASE_SECRET_KEYS') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() || '';
}

function getAllowedOrigins(): string[] {
  const configured = Deno.env.get('PASSWORD_RESET_ALLOWED_ORIGINS');
  const values = configured
    ? configured.split(',').map((value) => value.trim()).filter(Boolean)
    : DEFAULT_ALLOWED_ORIGINS;
  return [...new Set(values.map((value) => value.replace(/\/$/, '')))];
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  origin: string,
  allowedOrigins: string[],
): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  });
  if (allowedOrigins.includes(origin.replace(/\/$/, ''))) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  headers.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  return new Response(JSON.stringify(body), { status, headers });
}

function isValidEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const email = value.trim();
  if (!(email.length >= 5 && email.length <= 254) || /\s|[\u0000-\u001f\u007f]/.test(email)) return false;
  const separator = email.lastIndexOf('@');
  if (separator < 1 || separator > 64 || separator === email.length - 1) return false;
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  return domain.length <= 253
    && /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(domain);
}

async function fingerprintEmail(email: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(email));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}


Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  const origin = request.headers.get('Origin') ?? '';
  const allowedOrigins = getAllowedOrigins();
  const normalizedOrigin = origin.replace(/\/$/, '');

  if (request.method === 'OPTIONS') {
    if (!origin || !allowedOrigins.includes(normalizedOrigin)) {
      return jsonResponse({ code: 'ORIGIN_NOT_ALLOWED', message: 'এই ওয়েব ঠিকানা থেকে অনুরোধ গ্রহণ করা হচ্ছে না।', request_id: requestId }, 403, origin, allowedOrigins);
    }
    const headers = new Headers({
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Cache-Control': 'no-store',
      'Vary': 'Origin',
    });
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ code: 'METHOD_NOT_ALLOWED', message: 'শুধু POST অনুরোধ গ্রহণযোগ্য।', request_id: requestId }, 405, origin, allowedOrigins);
  }

  if (!origin || !allowedOrigins.includes(normalizedOrigin)) {
    return jsonResponse({ code: 'ORIGIN_NOT_ALLOWED', message: 'এই ওয়েব ঠিকানা থেকে অনুরোধ গ্রহণ করা হচ্ছে না।', request_id: requestId }, 403, origin, allowedOrigins);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = publishableKey();
  const serviceRoleKey = secretKey();
  const hmacSecret = Deno.env.get('PASSWORD_RESET_HMAC_SECRET') ?? '';

  if (!supabaseUrl || !anonKey || !serviceRoleKey || hmacSecret.length < 32) {
    console.error('request-password-reset configuration missing', {
      request_id: requestId,
      has_url: Boolean(supabaseUrl),
      has_anon_key: Boolean(anonKey),
      has_service_role_key: Boolean(serviceRoleKey),
      has_hmac_secret: hmacSecret.length >= 32,
    });
    return jsonResponse({ code: 'SERVER_CONFIGURATION_MISSING', message: 'পাসওয়ার্ড রিসেট সেবা এই মুহূর্তে প্রস্তুত নয়। পরে আবার চেষ্টা করুন।', request_id: requestId }, 503, origin, allowedOrigins);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const consumeGeoNonce = async (nonce: string, timestamp: string): Promise<boolean> => {
    const { data, error } = await admin.rpc('hl_consume_geo_proxy_nonce', {
      p_nonce: nonce, p_issued_at: new Date(Number(timestamp)).toISOString(),
    });
    if (error) {
      console.error('request-password-reset geo nonce store failed', { request_id: requestId, code: error.code });
      return false;
    }
    return data === true;
  };

  // Verify the Worker's body-bound HMAC before reading request.text(). The
  // shared verifier hashes a clone so the original body remains available.
  const visitor = await resolveTrustedVisitor(request, 'request-password-reset', consumeGeoNonce);
  const requestIp = visitor.ip;
  const location = visitor.proxyVerified
    ? visitor.location
    : { countryCode: visitor.location.countryCode, city: null, region: null, regionCode: null };
  if (!visitor.ok || !requestIp) {
    return jsonResponse({ code: visitor.code || 'CLIENT_IP_UNAVAILABLE', message: 'নিরাপত্তার জন্য নির্ভরযোগ্য Client IP যাচাই করা যাচ্ছে না। অনুগ্রহ করে কিছুক্ষণ পরে আবার চেষ্টা করুন।', request_id: requestId }, 503, origin, allowedOrigins);
  }

  let body: { email?: unknown };
  try {
    const rawBody = await request.text();
    if (rawBody.length > 2048) {
      return jsonResponse({ code: 'REQUEST_TOO_LARGE', message: 'অনুরোধটি গ্রহণ করা যায়নি।', request_id: requestId }, 413, origin, allowedOrigins);
    }
    body = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ code: 'INVALID_REQUEST', message: 'অনুরোধের তথ্য পড়া যায়নি।', request_id: requestId }, 400, origin, allowedOrigins);
  }

  if (!isValidEmail(body.email)) {
    return jsonResponse({ code: 'INVALID_EMAIL', message: 'একটি সঠিক ইমেইল ঠিকানা লিখুন।', request_id: requestId }, 400, origin, allowedOrigins);
  }

  const email = body.email.trim().toLowerCase();
  const emailFingerprint = await fingerprintEmail(email, hmacSecret);
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  try {
    // Network-level app protection is independent of the per-email quota. The
    // third request from a trusted IP in one hour starts a one-hour IP block.
    const { data: ipGateData, error: ipGateError } = await admin.rpc('hl_consume_password_reset_ip_request_v2', {
      p_request_ip: requestIp,
      p_country_code: location.countryCode,
      p_city: location.city,
      p_region: location.region,
      p_region_code: location.regionCode,
    });
    if (ipGateError) {
      console.error('request-password-reset IP gate failed', { request_id: requestId, code: ipGateError.code, message: ipGateError.message });
      return jsonResponse({ code: 'IP_RATE_LIMIT_CHECK_FAILED', message: 'নিরাপত্তা যাচাই করা যায়নি। কিছুক্ষণ পরে আবার চেষ্টা করুন।', request_id: requestId }, 503, origin, allowedOrigins);
    }
    if (ipGateData?.reason === 'client_ip_unavailable') {
      return jsonResponse({ code: 'CLIENT_IP_UNAVAILABLE', message: 'নিরাপত্তার জন্য নির্ভরযোগ্য Client IP যাচাই করা যাচ্ছে না। পরে আবার চেষ্টা করুন।', request_id: requestId }, 503, origin, allowedOrigins);
    }
    if (ipGateData?.allowed === false) {
      return jsonResponse({
        code: 'PASSWORD_RESET_IP_TEMPORARILY_BLOCKED',
        message: 'নিরাপত্তার জন্য এই নেটওয়ার্ক থেকে এক ঘণ্টায় সর্বোচ্চ ২টি Password Reset অনুরোধ গ্রহণ করা হয়। সীমা অতিক্রম করায় ১ ঘণ্টার জন্য নতুন অনুরোধ বন্ধ রাখা হয়েছে।',
        retry_at: ipGateData.retry_at || ipGateData.blocked_until || null,
        retry_after_seconds: ipGateData.retry_after_seconds || 3600,
        request_id: requestId,
      }, 429, origin, allowedOrigins);
    }

    const { data: quotaData, error: quotaError } = await admin.rpc('consume_password_reset_quota', {
      p_email_fingerprint: emailFingerprint,
    });

    if (quotaError) {
      console.error('request-password-reset quota check failed', {
        request_id: requestId,
        code: quotaError.code,
        message: quotaError.message,
      });
      return jsonResponse({ code: 'QUOTA_CHECK_FAILED', message: 'পাসওয়ার্ড রিসেটের সীমা যাচাই করা যায়নি। কিছুক্ষণ পরে আবার চেষ্টা করুন।', request_id: requestId }, 503, origin, allowedOrigins);
    }

    const quota = quotaData as QuotaResult | null;
    if (!quota || typeof quota.allowed !== 'boolean') {
      console.error('request-password-reset quota response invalid', { request_id: requestId });
      return jsonResponse({ code: 'QUOTA_RESPONSE_INVALID', message: 'পাসওয়ার্ড রিসেটের সীমা যাচাই করা যায়নি। পরে আবার চেষ্টা করুন।', request_id: requestId }, 503, origin, allowedOrigins);
    }

    if (!quota.allowed) {
      const daily = quota.reason === 'daily_limit';
      const message = daily
        ? 'নিরাপত্তার জন্য একটি দিনে সর্বোচ্চ ২টি পাসওয়ার্ড রিসেটের অনুরোধ করা যাবে। আগামীকাল আবার চেষ্টা করুন।'
        : 'এই ইমেইলের জন্য চলতি মাসের সর্বোচ্চ ৫টি পাসওয়ার্ড রিসেট অনুরোধ সম্পন্ন হয়েছে। Help Section থেকে Hostel Life Support এ যোগাযোগ করুন। পরিচয় যাচাইয়ের পর Admin প্রয়োজন হলে Temporary Password দেবেন; সেটি দিয়ে লগইন করে বাধ্যতামূলকভাবে নতুন পাসওয়ার্ড সেট করতে হবে।';
      return jsonResponse({
        code: daily ? 'PASSWORD_RESET_DAILY_LIMIT' : 'PASSWORD_RESET_MONTHLY_LIMIT',
        message,
        retry_at: quota?.retry_at ?? null,
        daily_remaining: quota?.daily_remaining ?? 0,
        monthly_remaining: quota?.monthly_remaining ?? 0,
        request_id: requestId,
      }, 429, origin, allowedOrigins);
    }

    if (!quota.request_id || !/^[0-9a-f-]{36}$/i.test(quota.request_id)) {
      console.error('request-password-reset quota request id missing', { request_id: requestId });
      return jsonResponse({ code: 'QUOTA_REQUEST_ID_MISSING', message: 'পাসওয়ার্ড রিসেট অনুরোধ নিরাপদে সংরক্ষণ করা যায়নি। পরে আবার চেষ্টা করুন।', request_id: requestId }, 503, origin, allowedOrigins);
    }

    // Only allow redirecting back to the exact requesting origin and fixed reset path.
    const redirectTo = new URL('/auth/reset-password', normalizedOrigin).toString();
    const { error: authError } = await authClient.auth.resetPasswordForEmail(email, { redirectTo });

    if (authError) {
      // Refund the quota only for a definitive Auth HTTP error. A network failure
      // can be ambiguous (the email may already have been accepted), so it is not
      // refunded automatically to avoid duplicate sends.
      if (typeof authError.status === 'number') {
        const { error: releaseError } = await admin.rpc('release_password_reset_quota', {
          p_request_id: quota.request_id,
          p_email_fingerprint: emailFingerprint,
        });
        if (releaseError) {
          console.error('request-password-reset quota rollback failed', {
            request_id: requestId,
            code: releaseError.code,
            message: releaseError.message,
          });
        }
      }

      const status = authError.status === 429 ? 429 : 502;
      const code = authError.status === 429 ? 'SUPABASE_EMAIL_RATE_LIMIT' : 'EMAIL_REQUEST_FAILED';
      const message = authError.status === 429
        ? 'Database-এর বর্তমান ইমেইল পাঠানোর সীমা পূর্ণ হয়েছে। পরে আবার চেষ্টা করুন; আপনার দৈনিক/মাসিক ব্যক্তিগত সীমা কাটা হয়নি।'
        : 'রিসেট ইমেইল পাঠানোর অনুরোধ সম্পন্ন হয়নি। ইমেইল ঠিকানা ও Supabase Email Configuration যাচাই করে পরে চেষ্টা করুন।';
      return jsonResponse({ code, message, request_id: requestId }, status, origin, allowedOrigins);
    }

    // This is an email address, not a password or OTP. Store it in the dedicated
    // attempt_email field so Super Admin can inspect which address requested a
    // reset. The value is normalized and validated again inside the SQL writer.
    const { error: securityLogError } = await admin.rpc('hl_record_public_security_event_v4', {
      p_event_type: 'password_reset_requested',
      p_identity_fingerprint: null,
      p_ip_fingerprint: null,
      p_request_ip: requestIp,
      p_failure_code: null,
      p_user_agent: request.headers.get('user-agent')?.slice(0, 512) ?? null,
      p_request_origin: normalizedOrigin,
      p_country_code: location.countryCode,
      p_city: location.city,
      p_region: location.region,
      p_region_code: location.regionCode,
      p_attempt_email: email,
    });
    if (securityLogError) console.error('password reset success telemetry failed', { request_id: requestId, code: securityLogError.code });

    return jsonResponse({
      success: true,
      message: 'যদি এই ইমেইলে Hostel Life অ্যাকাউন্ট থাকে, রিসেট নির্দেশনা পাঠানো হলে আপনার ইনবক্স দেখুন।',
      daily_remaining: quota.daily_remaining ?? 0,
      monthly_remaining: quota.monthly_remaining ?? 0,
      request_id: requestId,
      function_version: FUNCTION_VERSION,
    }, 200, origin, allowedOrigins);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('request-password-reset unexpected error', { request_id: requestId, message });
    return jsonResponse({ code: 'UNEXPECTED_SERVER_ERROR', message: 'পাসওয়ার্ড রিসেট অনুরোধ সম্পন্ন করা যায়নি। পরে আবার চেষ্টা করুন।', request_id: requestId }, 500, origin, allowedOrigins);
  }
});
