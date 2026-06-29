const CACHE_NAME = "dealer-margin-calc-v2";
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.svg"
];

// Install Event
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log("[Service Worker] Caching core shell structures");
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate Event
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log("[Service Worker] Archiving old cache generation:", cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: Robust PWA strategy (Bypass cross-origin, Network-First for HTML, Cache-First for static assets)
self.addEventListener("fetch", (event) => {
  // 1. Only intercept GET method queries
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // 2. ONLY handle requests of the same origin
  // This prevents the Service Worker from interfering with Firebase Auth, Firestore DB, or external API streams!
  if (url.origin !== self.location.origin) {
    return;
  }

  // 3. Let browser-internal or developer debugging requests bypass sw cache safely
  if (url.pathname.includes("/__") || (url.hostname.includes("localhost") && url.port === "3000")) {
    return;
  }

  const isHtmlRequest = event.request.headers.get("accept")?.includes("text/html") || 
                        url.pathname === "/" || 
                        url.pathname.endsWith("/index.html");

  if (isHtmlRequest) {
    // --- Network-First Strategy for HTML Document ---
    // This ensures we always get the latest index.html (and its new JS/CSS hashes) when online,
    // but fall back to the cached version when offline. It prevents stale script blank screen errors!
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Offline fallback
          return caches.match("./index.html") || caches.match("/");
        })
    );
  } else {
    // --- Cache-First with Network Fallback for Hashed/Static Assets ---
    // Since Vite assets (JS, CSS) have unique hashes, they are immutable.
    // We can serve them from the cache instantly if they exist, or fetch them from the network and cache them.
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, responseToCache);
              });
            }
            return networkResponse;
          })
          .catch((err) => {
            console.warn("[Service Worker] Static asset fetch failed:", url.pathname, err);
            // If a local asset fails, let the browser handle or fail gracefully
            return null;
          });
      })
    );
  }
});
