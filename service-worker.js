/**
 * service-worker.js — makes the app installable and lets its shell load
 * instantly (and survive flaky signal) by caching the local files.
 *
 * Scope: caches ONLY the app's own files (same-origin). It deliberately does
 * NOT cache Mapbox requests -- tiles, the Directions/Search APIs, and the GL
 * JS bundle must stay live: a stale cached route or search result would be
 * wrong, and tiles would bloat storage fast. Anything not in the app shell
 * just goes to the network as normal.
 *
 * CACHE_VERSION: the GitHub Pages deploy workflow replaces "ngtd-dev" with
 * "ngtd-<commit id>", so every deploy gets a fresh cache. Keep the literal
 * "ngtd-dev" here -- the workflow checks that its stamp landed.
 *
 * Cache names are per ORIGIN, not per site path, and this app can share an
 * origin (patrick87656.github.io) with the internal KPR planner. So the
 * activate handler only deletes OLD caches of this app (the "ngtd-" prefix),
 * never another app's caches.
 */
const CACHE_PREFIX = "ngtd-";
const CACHE_VERSION = "ngtd-dev";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/ocean-lut.js",
  "./js/geo-permission.js",
  "./js/map.js",
  "./js/waypoints.js",
  "./js/routing.js",
  "./js/scenes.js",
  "./js/vendor/qrcodegen-v1.8.0-es5.js",
  "./js/route-codec.js",
  "./js/search.js",
  "./js/storage.js",
  "./js/share.js",
  "./js/open-link.js",
  "./js/drive.js",
  "./js/geo-dialog.js",
  "./js/enable-location-strip.js",
  "./js/sheet.js",
  "./js/app.js",
  "./config.local.js",
  "./manifest.webmanifest",
  "./icons/nissan-wordmark-white.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // addAll fails the whole install if any file 404s; add individually
      // and ignore misses so a renamed/absent optional file (e.g. a missing
      // config.local.js) doesn't block install.
      Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => console.warn("SW: skip caching", url, err && err.message))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_VERSION)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Not our file (Mapbox tiles/APIs/CDN, Google Fonts, etc.) -> straight to
  // the network, never cached here.
  if (url.origin !== self.location.origin) return;

  // App shell: serve from cache first for instant loads, fall back to the
  // network, and refresh the cache copy in the background when online.
  event.respondWith(
    caches.match(req).then((cached) => {
      const fromNet = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached); // offline and not cached -> undefined
      return cached || fromNet;
    })
  );
});
