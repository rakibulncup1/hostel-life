import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const workerUrlValue = import.meta.env.VITE_HOSTEL_SECURITY_WORKER_URL?.trim() || '';

export const supabaseConfigReady = Boolean(supabaseUrl && supabaseKey);

const SECURITY_FUNCTION_PATHS = new Set([
  '/functions/v1/auth-security-gate',
  '/functions/v1/record-auth-event',
  '/functions/v1/request-password-reset',
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
// Treat any non-empty Worker setting as an enabled security requirement, even
// when malformed. Invalid configuration must never silently fall back to the
// direct Supabase endpoint for these three protected Function routes.
export const securityGeoProxyEnabled = Boolean(workerUrlValue);

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

    if (!securityWorkerOrigin) {
      throw new TypeError('Hostel Life security proxy URL is invalid. Correct VITE_HOSTEL_SECURITY_WORKER_URL or remove it deliberately to use direct mode.');
    }
    if (requestUrl.search || requestUrl.hash) {
      throw new TypeError('Hostel Life security proxy does not accept query strings or fragments.');
    }

    let request;
    try {
      request = new Request(input, init);
    } catch {
      // Do not let a Request-construction/body error turn a protected request
      // into a direct-Supabase request.
      throw new TypeError('Hostel Life security proxy could not prepare the protected request.');
    }

    // Route only the three Auth/Security Edge Functions through Cloudflare.
    // Supabase Auth, PostgREST, Storage, Realtime, and all other Functions keep
    // using the original Supabase origin.
    const target = `${securityWorkerOrigin}${requestUrl.pathname}`;
    const routedRequest = new Request(target, request);
    return nativeFetch(routedRequest);
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
