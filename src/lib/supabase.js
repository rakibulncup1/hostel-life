import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const workerUrlValue = import.meta.env.VITE_HOSTEL_SECURITY_WORKER_URL?.trim() || '';

export const supabaseConfigReady = Boolean(supabaseUrl && supabaseKey);

const SECURITY_FUNCTION_PATHS = new Set([
  '/functions/v1/auth-security-gate',
  '/functions/v1/record-auth-event',
  '/functions/v1/request-password-reset',
  '/functions/v1/request-signup-otp',
]);

function normalizeWorkerOrigin(value) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname);
    if ((!localHttp && parsed.protocol !== 'https:') || parsed.username || parsed.password ||
        parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('Worker URL must be an HTTPS origin without a path, query, or credentials.');
    }
    return parsed.origin;
  } catch (error) {
    console.error('[Hostel Life] Invalid VITE_HOSTEL_SECURITY_WORKER_URL:', error?.message || 'invalid_url');
    return null;
  }
}

const securityWorkerOrigin = normalizeWorkerOrigin(workerUrlValue);
// Cloudflare is an optional signed IP-security proxy. Supabase ingress remains
// the direct fallback so a Worker outage can never prevent login or OTP delivery.
export const securityGeoProxyEnabled = Boolean(securityWorkerOrigin);

function createSecurityAwareFetch() {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  if (!supabaseUrl || !workerUrlValue) return nativeFetch;

  let supabaseOrigin;
  try {
    supabaseOrigin = new URL(supabaseUrl).origin;
  } catch {
    return async () => { throw new TypeError('Hostel Life Supabase URL is invalid while the security proxy is enabled.'); };
  }

  return async (input, init) => {
    let requestUrl;
    try {
      const candidate = input instanceof Request ? input.url : String(input);
      requestUrl = new URL(candidate);
    } catch {
      return nativeFetch(input, init);
    }

    const isProtectedRoute = requestUrl.origin === supabaseOrigin && SECURITY_FUNCTION_PATHS.has(requestUrl.pathname);
    if (!isProtectedRoute) return nativeFetch(input, init);

    if (!securityWorkerOrigin || requestUrl.search || requestUrl.hash) return nativeFetch(input, init);

    let request;
    try {
      request = new Request(input, init);
    } catch {
      // If request cloning is impossible, prefer the original safe Supabase path.
      return nativeFetch(input, init);
    }

    // The Worker is optional. Route only the four first-party security Functions;
    // on Worker configuration/transport/Geo-signature errors retry directly through
    // Supabase's Cloudflare ingress. Real 429 blocks and application responses are kept.
    const target = `${securityWorkerOrigin}${requestUrl.pathname}`;
    try {
      const workerResponse = await nativeFetch(new Request(target, request.clone()));
      if ([502, 503, 504].includes(workerResponse.status)) {
        let code = '';
        try { code = String((await workerResponse.clone().json())?.code || ''); } catch { /* Non-JSON Worker response. */ }
        const proxyFailure = /^(?:PROXY_CONFIGURATION_MISSING|CLOUDFLARE_CLIENT_IP_UNAVAILABLE|SUPABASE_FUNCTION_UNREACHABLE|GEO_PROXY_[A-Z0-9_]+|CLIENT_IP_UNAVAILABLE|AUTH_GATE_LOOKUP_FAILED)$/.test(code);
        if (proxyFailure) return nativeFetch(new Request(requestUrl.href, request.clone()));
      }
      return workerResponse;
    } catch {
      return nativeFetch(new Request(requestUrl.href, request.clone()));
    }
  };
}

export const supabase = supabaseConfigReady
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      global: {
        fetch: createSecurityAwareFetch(),
      },
    })
  : null;
