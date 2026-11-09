// Service worker: makes the app work offline and installable.
// It only ever fetches this site's own files; it never sees your manuscript
// (files are read with the File API, not over the network).
const VERSION = 'v7';
const CACHE = `manuscript-reader-${VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'app.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-180.png',
  'src/ui/app.js',
  'src/ui/reader.js',
  'src/core/convert.js',
  'src/core/docx.js',
  'src/core/xml.js',
  'src/core/txt.js',
  'src/core/structure.js',
  'src/core/typography.js',
  'src/core/patterns.js',
  'src/core/lang.js',
  'src/core/dehyphen.js',
  'src/core/report.js',
  'src/core/headings.js',
  'src/core/diagnostic.js',
  'src/core/epub.js',
  'src/core/pdf/reader.js',
  'src/core/pdf/reflow.js',
  'vendor/fflate/fflate.mjs',
  'vendor/pdfjs/pdf.min.mjs',
  'vendor/pdfjs/pdf.worker.min.mjs',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

// Stale-while-revalidate for our own files: instant and offline-capable,
// and updated in the background when online.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (cached) {
      event.waitUntil(network);
      return cached;
    }
    const res = await network;
    if (res) return res;
    if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
    return Response.error();
  })());
});
