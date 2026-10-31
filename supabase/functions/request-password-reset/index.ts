// Public recovery entry point. Deploy with JWT verification disabled because
// users are not authenticated when requesting a password-reset email.
// The function itself enforces an HMAC-keyed email quota before calling Auth.
// Never expose SUPABASE_SERVICE_ROLE_KEY or PASSWORD_RESET_HMAC_SECRET to clients.
import { createClient } from 'npm:@supabase/supabase-js@2';

const FUNCTION_VERSION = '2026-10-31-password-reset-quota-1';
const DEFAULT_ALLOWED_ORIGINS = [
  'https://hostellife-bd.vercel.app',
  'http://localhost:5173',
  'http://easy-hostellife.vercel.app',

];

type QuotaResult = {
  allowed?: boolean;
  reason?: 'daily_limit' | 'monthly_limit';
  request_id?: string;
  retry_at?: string;
  daily_remaining?: number;
  monthly_remaining?: number;
};

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

function isValidEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const email = value.trim();
  return email.length >= 5 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
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
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  try {
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
        ? 'নিরাপত্তার জন্য একটি দিনে একবারই পাসওয়ার্ড রিসেটের অনুরোধ করা যাবে। আগামীকাল আবার চেষ্টা করুন।'
        : 'এই ইমেইলের জন্য চলতি মাসের সর্বোচ্চ ৩টি পাসওয়ার্ড রিসেট অনুরোধ সম্পন্ন হয়েছে। Help Section থেকে Hostel Life Support এ যোগাযোগ করুন। পরিচয় যাচাইয়ের পর Admin প্রয়োজন হলে Temporary Password দেবেন; সেটি দিয়ে লগইন করে বাধ্যতামূলকভাবে নতুন পাসওয়ার্ড সেট করতে হবে।';
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
