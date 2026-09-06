// Minimal, dependency-free service worker for installable-PWA support.
//
// Deliberately conservative about caching: it NEVER caches the app's HTML,
// JS, or API responses, so an installed user can never be served stale app
// code after a deploy (a real concern for this app - the canonical URL must
// always serve the latest build). It only:
//   - precaches a tiny offline fallback page + the app icons/manifest,
//   - serves cache-first for our own static images/fonts,
//   - shows the offline page when a navigation fails with no network,
//   - passes everything else straight through to the network.
//
// It also handles Web Push: showing the notification the server sent, and
// taking the user to the right screen when they tap it. See src/lib/push-server.ts.
//
// Bumping CACHE invalidates the old precache on activate.
const CACHE = "invoice-app-static-v2";
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

// ---------------------------------------------------------------------------
// Web Push
// ---------------------------------------------------------------------------

const PUSH_FALLBACK_URL = "/notifications";

// Only ever navigate to a path on our own origin. The payload is signed by
// VAPID and comes from our server, but a service worker that will open any URL
// it is handed is one compromise away from being an open redirect.
function safePath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return PUSH_FALLBACK_URL;
  }
  return value;
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = typeof payload.title === "string" && payload.title ? payload.title : "עדכון חדש";
  const url = safePath(payload.url);

  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof payload.body === "string" ? payload.body : "",
      data: { url },
      icon: "/logo-192.png",
      badge: "/logo-192.png",
      dir: "rtl",
      lang: "he",
      // The notification id: a retried send replaces the banner instead of
      // stacking a second copy of the same event.
      tag: typeof payload.id === "string" ? payload.id : undefined,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safePath(event.notification.data && event.notification.data.url);
  const target = new URL(url, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Reuse an open tab of the app rather than opening a third one.
        for (const client of clientList) {
          if (new URL(client.url).origin !== self.location.origin) continue;
          if ("navigate" in client) {
            return client.navigate(target).then((c) => (c ? c.focus() : undefined));
          }
          return client.focus();
        }
        return self.clients.openWindow(target);
      }),
  );
});
