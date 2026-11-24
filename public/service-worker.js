// Bump this cache name when changing the cached app-shell contract.
const CACHE_NAME = 'hostel-life-shell-v22';
const APP_CACHE_PREFIX = 'hostel-life-shell-v';
const APP_SHELL = [
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

async function isStylesheetResponse(response) {
  if (!response || !response.ok) return false;
  const contentType = (response.headers.get('content-type') || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  return contentType === 'text/css';
}

async function migrateStylesheetsFromPreviousCaches(cacheNames, currentCache) {
  for (const cacheName of cacheNames) {
    const previousCache = await caches.open(cacheName);
    const requests = await previousCache.keys();

    for (const request of requests) {
      const url = new URL(request.url);
      if (url.origin !== self.location.origin || !url.pathname.toLowerCase().endsWith('.css')) continue;
      if (await currentCache.match(request)) continue;

      const response = await previousCache.match(request);
      if (await isStylesheetResponse(response)) {
        await currentCache.put(request, response.clone());
      }
    }
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(async (keys) => {
        // Keep unrelated origin caches intact. Migrate previously cached CSS
        // before removing the older Hostel Life cache versions so already-open
        // tabs and offline public pages retain a last-known-good stylesheet.
        const previousAppCaches = keys.filter((key) => key.startsWith(APP_CACHE_PREFIX) && key !== CACHE_NAME);
        const currentCache = await caches.open(CACHE_NAME);
        await migrateStylesheetsFromPreviousCaches(previousAppCaches, currentCache);
        await Promise.all(previousAppCaches.map((key) => caches.delete(key)));
      })
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

async function networkFirstStylesheet(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    // Public landing CSS uses stable filenames, so always check the network first
    // and replace the cached copy only after receiving a real CSS response. This
    // avoids permanently caching an HTML fallback returned for a missing .css URL.
    const response = await fetch(request, { cache: 'no-store' });
    if (await isStylesheetResponse(response)) {
      await cache.put(request, response.clone());
      return response;
    }

    const cached = await cache.match(request);
    return cached || response;
  } catch (error) {
    const cached = await cache.match(request);
    if (await isStylesheetResponse(cached)) return cached;
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
    // Public legal/about pages are standalone HTML documents, not the React SPA.
    // Keep them network-only so they are never cached under the /index.html app-shell key.
    const publicDocumentPaths = new Set([
      '/', '/about', '/about.html',
      '/privacy-policy', '/privacy-policy.html',
      '/terms-of-service', '/terms-of-service.html',
    ]);
    if (publicDocumentPaths.has(url.pathname)) {
      // Keep public documents network-only while online. If the device is
      // offline, fall back to the already-cached SPA shell; App.jsx will route
      // a previously authenticated active member to Dashboard. Public HTML is
      // never cached under its own URL, and unauthenticated users still see the
      // normal login flow after the shell loads.
      event.respondWith((async () => {
        try {
          const response = await fetch(request, { cache: 'no-store' });
          // Preserve normal public-page 4xx responses. For network/server
          // failures, use the cached SPA shell so offline auth can route safely.
          if (response && (response.ok || response.status < 500)) return response;
          const appShell = await caches.match('/index.html');
          return appShell || response;
        } catch (error) {
          const appShell = await caches.match('/index.html');
          if (appShell) return appShell;
          throw error;
        }
      })());
      return;
    }
    event.respondWith(
      networkFirst(request, '/index.html').catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Cover Vite's hashed app CSS and every public /landing-assets/*.css file.
  // Network-first gives users current CSS; cache fallback prevents transient
  // network failures from turning a page into plain, unstyled HTML.
  if (request.destination === 'style' || url.pathname.toLowerCase().endsWith('.css')) {
    event.respondWith(networkFirstStylesheet(request));
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    // Vite JS and icon URLs are immutable/content-addressed or stable assets.
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
