// Minimal, dependency-free service worker for installable-PWA support.
//
// Deliberately conservative about caching: it NEVER caches the app's HTML,
// JS, or API responses, so an installed user can never be served stale app
// code after a deploy (a real concern for this app — the canonical URL must
// always serve the latest build). It only:
//   - precaches a tiny offline fallback page + the app icons/manifest,
//   - serves cache-first for our own static images/fonts,
//   - shows the offline page when a navigation fails with no network,
//   - passes everything else straight through to the network.
//
// Bumping CACHE invalidates the old precache on activate.
const CACHE = "invoice-app-static-v1";
const PRECACHE = [
  "/offline.html",
  "/manifest.json",
  "/logo.svg",
  "/logo-192.png",
  "/logo-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Navigations: always try the network (fresh app code); fall back to the
  // offline page only when the network is unavailable.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline.html")),
    );
    return;
  }

  // Our own static images/fonts: cache-first (safe to cache; immutable-ish).
  if (
    url.origin === self.location.origin &&
    /\.(png|svg|ico|webp|woff2?)$/.test(url.pathname)
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Everything else (HTML documents, JS chunks, API calls): straight to the
  // network. No caching → no stale code, no stale data.
});
