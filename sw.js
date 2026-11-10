// Service worker: zorgt dat de app ook zonder internet opent.
// Eigen bestanden: eerst het netwerk (altijd de nieuwste versie), anders de kopie.
// Lettertypes van Google: eerst de kopie.

const CACHE = 'notitiemaker-v5';
const SHELL = [
  './', 'index.html', 'css/styles.css', 'manifest.webmanifest', 'icon.svg', 'icon-180.png',
  'js/main.js', 'js/board.js', 'js/store.js', 'js/model.js', 'js/ink.js', 'js/thumb.js',
  'js/ui.js', 'js/fx.js', 'js/print.js', 'js/versions.js', 'js/ocr.js', 'js/config.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    // no-cache: altijd bij de server navragen of er een nieuwere versie is.
    const fresh = req.mode === 'navigate' ? fetch(req.url, { cache: 'no-cache' }) : fetch(req, { cache: 'no-cache' });
    const res = await withTimeout(fresh, 4000);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') return cache.match('./');
    throw new Error('offline');
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) e.respondWith(networkFirst(req));
  else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') e.respondWith(cacheFirst(req));
});
