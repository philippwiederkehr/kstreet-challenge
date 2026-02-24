// KSTREET CHALLENGE - Service Worker
const CACHE_VERSION = 'v1';
const CACHE_NAME = `kstreet-${CACHE_VERSION}`;

// App shell files to pre-cache on install
const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// ── Install: pre-cache app shell ─────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

// ── Activate: clean old caches, claim clients ────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('kstreet-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: route by strategy ─────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Google Sheets API — network only (app's localStorage handles caching)
  if (url.hostname === 'docs.google.com') {
    return; // Let the browser handle it normally
  }

  // Google Fonts CSS & font files — cache first
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Icons — cache first (they never change)
  if (url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // App shell (HTML, CSS, JS, SVG) — stale-while-revalidate
  event.respondWith(staleWhileRevalidate(event.request));
});

// ── Cache-first strategy ─────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok || response.status === 0) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline and not cached — return basic offline response
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

// ── Stale-while-revalidate strategy ──────────────
async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);

  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      const cache = caches.open(CACHE_NAME).then((c) => {
        c.put(request, response.clone());
      });
    }
    return response;
  }).catch(() => null);

  // Return cached immediately if available, otherwise wait for network
  if (cached) {
    // Trigger revalidation in background (don't await)
    fetchPromise;
    return cached;
  }

  const networkResponse = await fetchPromise;
  if (networkResponse) return networkResponse;

  // Nothing cached, nothing from network
  return new Response('Offline', { status: 503, statusText: 'Offline' });
}
