const CACHE_NAME = "dealer-margin-calc-v1";
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

// Fetch Event: Stale-While-Revalidate Strategy (fast, offline-capable, auto-updating)
self.addEventListener("fetch", (event) => {
  // Only intercept GET method queries
  if (event.request.method !== "GET") return;

  // Let browser-internal or developer debugging requests bypass sw cache safely
  const url = new URL(event.request.url);
  if (url.pathname.includes("/__") || url.hostname.includes("localhost") && url.port === "3000") {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch((error) => {
          console.warn("[Service Worker] Fetch failed, relying strictly on offline cache:", error);
          // Fallback of missing pages to index.html offline handler
          if (event.request.headers.get("accept")?.includes("text/html")) {
            return caches.match("./index.html");
          }
        });

      // Returns the cached assets instantly if present, else wait for network response
      return cachedResponse || fetchPromise;
    })
  );
});
