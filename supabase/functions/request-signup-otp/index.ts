// Signup OTP resend endpoint. Uses Supabase Auth's native email OTP sender and
// the existing private security-event table for lightweight, server-side quotas.
// No OTP, password, or third-party email credential is stored here.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { resolveTrustedVisitor } from '../_shared/geoProxy.ts';

const DEFAULT_ALLOWED_ORIGINS = [
  'https://hostellife-bd.vercel.app',
  'https://easy-hostellife.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

function defaultApiKey(mapName: string): string {
  const raw = Deno.env.get(mapName)?.trim() ?? '';
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    const value = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).default : null;
    return typeof value === 'string' ? value.trim() : '';
  } catch { return ''; }
}

function publishableKey(): string {
  return defaultApiKey('SUPABASE_PUBLISHABLE_KEYS') || Deno.env.get('SUPABASE_ANON_KEY')?.trim() || '';
}

function secretKey(): string {
  return defaultApiKey('SUPABASE_SECRET_KEYS') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() || '';
}

function allowedOrigins(): string[] {
  const configured = Deno.env.get('PASSWORD_RESET_ALLOWED_ORIGINS') || Deno.env.get('HOSTEL_SECURITY_ALLOWED_ORIGINS');
  const values: string[] = configured ? configured.split(',').map((value) => value.trim()).filter(Boolean) : DEFAULT_ALLOWED_ORIGINS;
  return [...new Set(values.map((value) => value.replace(/\/$/, '')))];
}

function reply(body: Record<string, unknown>, status: number, origin: string, origins: string[]): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
  });
  if (origins.includes(origin.replace(/\/$/, ''))) headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  return new Response(JSON.stringify(body), { status, headers });
}

function validEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const email = value.trim();
  if (email.length < 5 || email.length > 254 || /\s|[\u0000-\u001f\u007f]/.test(email)) return false;
  const at = email.lastIndexOf('@');
  if (at < 1 || at > 64 || at === email.length - 1) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)
    && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..')
    && domain.length <= 253
    && /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(domain);
}

async function fingerprintEmail(email: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(email));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  const origin = request.headers.get('Origin') ?? '';
  const origins = allowedOrigins();
  const normalizedOrigin = origin.replace(/\/$/, '');

  if (request.method === 'OPTIONS') {
    if (!origin || !origins.includes(normalizedOrigin)) return reply({ code: 'ORIGIN_NOT_ALLOWED', message: 'এই ওয়েব ঠিকানা থেকে অনুরোধ গ্রহণ করা হচ্ছে না।' }, 403, origin, origins);
    const headers = new Headers({ 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store', 'Vary': 'Origin' });
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== 'POST') return reply({ code: 'METHOD_NOT_ALLOWED', message: 'শুধু POST অনুরোধ গ্রহণযোগ্য।' }, 405, origin, origins);
  if (!origin || !origins.includes(normalizedOrigin)) return reply({ code: 'ORIGIN_NOT_ALLOWED', message: 'এই ওয়েব ঠিকানা থেকে অনুরোধ গ্রহণ করা হচ্ছে না।' }, 403, origin, origins);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = publishableKey();
  const serviceKey = secretKey();
  const hmacSecret = Deno.env.get('PASSWORD_RESET_HMAC_SECRET') ?? '';
  if (!url || !anonKey || !serviceKey || hmacSecret.length < 32) {
    console.error('request-signup-otp configuration missing', { request_id: requestId });
    return reply({ code: 'SERVER_CONFIGURATION_MISSING', message: 'ইমেইল যাচাই সেবা এই মুহূর্তে প্রস্তুত নয়। পরে আবার চেষ্টা করুন।', request_id: requestId }, 503, origin, origins);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const consumeNonce = async (nonce: string, timestamp: string): Promise<boolean> => {
    const { data, error } = await admin.rpc('hl_consume_geo_proxy_nonce', {
      p_nonce: nonce,
      p_issued_at: new Date(Number(timestamp)).toISOString(),
    });
    if (error) {
      console.error('request-signup-otp nonce check failed', { request_id: requestId, code: error.code });
      return false;
    }
    return data === true;
  };

  const visitor = await resolveTrustedVisitor(request, 'request-signup-otp', consumeNonce);
  if (!visitor.ok || !visitor.ip) {
    return reply({ code: visitor.code || 'CLIENT_IP_UNAVAILABLE', message: 'নিরাপত্তার জন্য নির্ভরযোগ্য নেটওয়ার্ক তথ্য যাচাই করা যাচ্ছে না। পরে আবার চেষ্টা করুন।', request_id: requestId }, 503, origin, origins);
  }

  let body: { email?: unknown };
  try {
    const rawBody = await request.text();
    if (rawBody.length > 2048) return reply({ code: 'REQUEST_TOO_LARGE', message: 'অনুরোধটি গ্রহণ করা যায়নি।' }, 413, origin, origins);
    body = JSON.parse(rawBody);
  } catch {
    return reply({ code: 'INVALID_REQUEST', message: 'অনুরোধের তথ্য পড়া যায়নি।' }, 400, origin, origins);
  }
  if (!validEmail(body.email)) return reply({ code: 'INVALID_EMAIL', message: 'একটি সঠিক ইমেইল ঠিকানা লিখুন।' }, 400, origin, origins);

  const email = body.email.trim().toLowerCase();
  try {
    const fingerprint = await fingerprintEmail(email, hmacSecret);
    const quota = await admin.rpc('hl_consume_signup_otp_resend', {
      p_email_fingerprint: fingerprint,
      p_attempt_email: email,
      p_request_ip: visitor.ip,
      p_country_code: visitor.proxyVerified ? visitor.location?.countryCode || null : null,
      p_city: visitor.proxyVerified ? visitor.location?.city || null : null,
      p_region: visitor.proxyVerified ? visitor.location?.region || null : null,
      p_region_code: visitor.proxyVerified ? visitor.location?.regionCode || null : null,
      p_user_agent: request.headers.get('user-agent') || null,
      p_request_origin: origin,
    });
    if (quota.error) {
      console.error('request-signup-otp quota check failed', { request_id: requestId, code: quota.error.code });
      return reply({ code: 'OTP_RATE_LIMIT_CHECK_FAILED', message: 'নিরাপত্তা যাচাই করা যায়নি। কিছুক্ষণ পরে আবার চেষ্টা করুন।', request_id: requestId }, 503, origin, origins);
    }
    if (quota.data?.reason === 'client_ip_unavailable') {
      return reply({ code: 'CLIENT_IP_UNAVAILABLE', message: 'নিরাপত্তার জন্য নেটওয়ার্ক তথ্য যাচাই করা যায়নি।' }, 503, origin, origins);
    }
    if (quota.data?.allowed === false) {
      return reply({
        code: 'SIGNUP_OTP_RATE_LIMITED',
        message: quota.data.reason === 'ip_hourly_limit'
          ? 'এই নেটওয়ার্ক থেকে এক ঘণ্টায় সর্বোচ্চ ২টি পুনরায় কোড পাঠানোর অনুরোধ গ্রহণ করা হয়। কিছুক্ষণ পরে চেষ্টা করুন।'
          : 'এই ইমেইলে প্রতিদিন সর্বোচ্চ ২ বার নতুন কোড পাঠানো যায়। নির্ধারিত সময় পরে আবার চেষ্টা করুন।',
        retry_at: quota.data.retry_at,
        retry_after_seconds: quota.data.retry_after_seconds || 3600,
        request_id: requestId,
      }, 429, origin, origins);
    }

    const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data, error } = await authClient.auth.resend({ type: 'signup', email });
    if (error) {
      console.warn('request-signup-otp auth resend failed', { request_id: requestId, status: (error as { status?: number }).status || null, code: (error as { code?: string }).code || null });
      const status = (error as { status?: number }).status === 429 ? 429 : 400;
      return reply({ code: status === 429 ? 'SUPABASE_AUTH_RATE_LIMITED' : 'OTP_RESEND_FAILED', message: status === 429 ? 'ইমেইল পাঠানোর সীমা পূর্ণ হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।' : 'এই ইমেইলে নতুন ভেরিফিকেশন কোড পাঠানো যায়নি। ঠিকানাটি যাচাই করে আবার চেষ্টা করুন।', request_id: requestId }, status, origin, origins);
    }
    return reply({ accepted: true, message: 'নতুন ভেরিফিকেশন কোড পাঠানো হয়েছে।', user: data?.user ? { id: data.user.id } : null }, 200, origin, origins);
  } catch (error) {
    console.error('request-signup-otp failed', { request_id: requestId, message: error instanceof Error ? error.message : 'unknown_error' });
    return reply({ code: 'OTP_RESEND_UNAVAILABLE', message: 'এখন কোড পাঠানো যাচ্ছে না। কিছুক্ষণ পরে আবার চেষ্টা করুন।', request_id: requestId }, 503, origin, origins);
  }
});
