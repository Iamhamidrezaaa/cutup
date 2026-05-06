// BUILD: DASH_PROFILE_2026_01 — no asset caching; dashboard/checkout served from network.
self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) { return caches.delete(name); }));
    })
  );
});

self.addEventListener('fetch', function () {});
