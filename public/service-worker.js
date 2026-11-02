// Bump this cache name when changing the cached app-shell contract.
const CACHE_NAME = 'hostel-life-shell-v17';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/hostel-life-mark.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(request, cacheKey = request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.ok) await cache.put(cacheKey, response.clone());
  return response;
}

async function networkFirst(request, cacheKey = request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    // Refresh HTML only as a result of an actual navigation/request. This keeps
    // deployments current without background re-fetches of every static asset.
    const response = await fetch(request);
    if (response && response.ok) {
      await cache.put(cacheKey, response.clone());
      return response;
    }
    // A transient Vercel 5xx/404 for a SPA route should use the last known-good
    // app shell when available; direct route rewrites are still configured at Vercel.
    const cached = await cache.match(cacheKey);
    return cached || response;
  } catch (error) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Invitation tokens are bearer credentials. Never cache an invitation
    // navigation request/response; the app shell may be fetched network-only.
    if (url.pathname === '/invite' || url.pathname.startsWith('/invite/')) {
      event.respondWith(fetch(request, { cache: 'no-store' }));
      return;
    }
    event.respondWith(
      networkFirst(request, '/index.html').catch(() => caches.match('/index.html'))
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    // Vite asset URLs are content-hashed, so a cached URL is immutable. Do not
    // create another background network request when the asset is already cached.
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.pathname === '/manifest.webmanifest' || url.pathname === '/index.html') {
    event.respondWith(networkFirst(request));
  }
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
