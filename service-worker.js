/* =========================================================
   Kishore Kumar Ultimate Fan Jukebox — service-worker.js
   - App shell: cache-first (instant offline load)
   - Song matrix (songs.json): stale-while-revalidate
   Bump CACHE_VERSION whenever you change any shell file.
   ========================================================= */

const CACHE_VERSION = 'v1.4.0';
const SHELL_CACHE = `kk-shell-${CACHE_VERSION}`;
const DATA_CACHE = `kk-data-${CACHE_VERSION}`;

// Relative paths so it works under https://<user>.github.io/<repo>/
const SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];
const DATA_FILES = ['./songs.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      // cache: 'reload' bypasses the browser HTTP cache so a new version never stores stale files
      caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_FILES.map((u) => new Request(u, { cache: 'reload' })))),
      caches.open(DATA_CACHE).then((c) => c.addAll(DATA_FILES.map((u) => new Request(u, { cache: 'reload' }))))
    ]).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('kk-') && k !== SHELL_CACHE && k !== DATA_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let external links (YouTube) pass through
  if (url.pathname.includes('/tools/')) return;     // admin tools (video picker) are never cached

  // Song matrix: stale-while-revalidate
  if (url.pathname.endsWith('/songs.json')) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Page navigations: serve cached index.html when offline
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Everything else: cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});

async function staleWhileRevalidate(req) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  const network = fetch(req, { cache: 'no-cache' })
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await network) || new Response('{"bundles":[],"trivia":[]}', {
    headers: { 'Content-Type': 'application/json' }
  });
}
