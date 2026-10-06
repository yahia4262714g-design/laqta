/* ==========================================================================
   لقطة — عامل الخدمة
   بيخزّن ملفات التطبيق عشان يفتح ويشتغل بدون إنترنت.
   المشاريع نفسها محفوظة بـ localStorage، مش هون.
   ========================================================================== */

const CACHE = 'laqta-v3';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './vendor/three.js',
  './js/main.js',
  './js/stage.js',
  './js/anim.js',
  './js/store.js',
  './js/timeline.js',
  './js/look.js',
  './js/recorder.js',
  './js/icons.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('laqta-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  // التنقل: الشبكة أولاً عشان توصل آخر نسخة، والكاش احتياط بدون إنترنت
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // باقي الملفات: الكاش أولاً، وتحديث بالخلفية
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
