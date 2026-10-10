// KSTREET CHALLENGE - Service Worker
const CACHE_VERSION = 'v32';
const CACHE_NAME = `kstreet-${CACHE_VERSION}`;

// App shell files to pre-cache on install
const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css?v=17',
  '/script.js?v=25',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// ── Install: pre-cache app shell ─────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches, claim clients ────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const oldKeys = keys.filter(key => key.startsWith('kstreet-') && key !== CACHE_NAME);
      await Promise.all(oldKeys.map(key => caches.delete(key)));
      await self.clients.claim();

      // Returning visitors may have opened cached HTML from the previous worker.
      // Reload once on upgrades so they receive the current app and default filter.
      if (oldKeys.length > 0) {
        const clients = await self.clients.matchAll({ type: 'window' });
        // Navigation fetches wait for activation, so do not await them here.
        clients.forEach(client => client.navigate(client.url).catch(() => {}));
      }
    })()
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

  // Open the current app online; keep the installed shell available offline.
  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // App shell (HTML, CSS, JS, SVG) — stale-while-revalidate
  event.respondWith(staleWhileRevalidate(event.request));
});

// ── Network-first navigation strategy ────────────
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
      return response;
    }
  } catch {
    // Fall back to the installed app when the network is unavailable.
  }

  return await caches.match(request)
    || await caches.match('/index.html')
    || new Response('Offline', { status: 503, statusText: 'Offline' });
}

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
