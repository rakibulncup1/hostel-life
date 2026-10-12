import { supabase } from './supabase';

// Small, in-memory, per-user RPC cache. This is intentionally not persisted so
// one user/session can never inherit another user's server response.
const entries = new Map();
const inFlight = new Map();
const keyVersions = new Map();

async function userScope() {
  if (!supabase) return 'no-supabase';
  try {
    // getSession reads the SDK's current session; it does not make an Auth API call.
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id || 'signed-out';
  } catch {
    return 'unknown-user';
  }
}

function stableSerialize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

export async function cachedRequest(key, loader, { ttlMs = 30000, force = false } = {}) {
  if (typeof loader !== 'function') throw new TypeError('cachedRequest requires a loader function.');
  const scopedKey = `${await userScope()}::${key}::${stableSerialize({})}`;
  const now = Date.now();
  const cached = entries.get(scopedKey);
  // `force` bypasses a completed cache entry, not an already-running request.
  // Coalescing forced requests prevents simultaneous focus/realtime/retry events
  // from issuing duplicate RPC calls for the same user and resource.
  if (inFlight.has(scopedKey)) return inFlight.get(scopedKey);
  if (!force && cached && cached.expiresAt > now) return cached.value;

  const version = keyVersions.get(scopedKey) || 0;
  const task = Promise.resolve().then(loader).then((value) => {
    // A mutation may invalidate this cache while the request is in flight. Do not
    // let an older response repopulate the cache after invalidation.
    if (ttlMs > 0 && (keyVersions.get(scopedKey) || 0) === version) entries.set(scopedKey, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }).finally(() => {
    if (inFlight.get(scopedKey) === task) inFlight.delete(scopedKey);
  });
  inFlight.set(scopedKey, task);
  return task;
}

// With no keys: clear everything (used on auth/session changes).
// With keys: clear those named scopes, e.g. invalidateRequestCache('dashboard:').
export function invalidateRequestCache(...scopePrefixes) {
  const prefixes = scopePrefixes.flat().filter((item) => typeof item === 'string' && item.length);
  if (prefixes.length === 0) {
    entries.clear();
    for (const key of inFlight.keys()) keyVersions.set(key, (keyVersions.get(key) || 0) + 1);
    inFlight.clear();
    return;
  }
  for (const key of entries.keys()) {
    const scope = key.split('::').slice(1).join('::');
    if (prefixes.some((prefix) => scope.startsWith(prefix))) {
      entries.delete(key);
      keyVersions.set(key, (keyVersions.get(key) || 0) + 1);
    }
  }
  // Do not cancel in-flight writes/reads. Deleting their key lets subsequent
  // reads request fresh data, and old promises will only return to their callers.
  for (const key of inFlight.keys()) {
    const scope = key.split('::').slice(1).join('::');
    if (prefixes.some((prefix) => scope.startsWith(prefix))) {
      keyVersions.set(key, (keyVersions.get(key) || 0) + 1);
      inFlight.delete(key);
    }
  }
}
