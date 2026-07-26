// Service worker de TableLive: solo se encarga de que la app se pueda instalar
// y de cachear los archivos estáticos (HTML/CSS/JS/íconos). Todo lo que es en
// vivo (API, socket.io, video) siempre va directo a la red, nunca a la caché.

const CACHE_NAME = "tablelive-v4";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/client.js",
  "/i18n.js",
  "/countries.js",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // nunca tocar POST (login, jugadas, subir contenido, etc.)

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // nunca tocar Jitsi ni nada externo
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io/")) return; // siempre en vivo, nunca cacheado
  if (url.pathname.startsWith("/uploads/") || url.pathname.startsWith("/avatars/")) return; // contenido de usuarios, siempre fresco

  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
