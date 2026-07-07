/* Service worker — Carnet Café
   Cache l'application pour un usage 100 % hors-ligne. */
const CACHE = "carnet-cafe-v5";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* Stratégie : réseau d'abord (pour recevoir les mises à jour),
   cache en secours quand on est hors-ligne.
   Les polices Google sont mises en cache à la volée. */
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // cache: "no-cache" force la revalidation auprès du serveur pour que
  // les mises à jour de l'app soient prises en compte immédiatement.
  const req = e.request.url.startsWith(self.location.origin)
    ? new Request(e.request, { cache: "no-cache" })
    : e.request;
  e.respondWith(
    fetch(req).then((resp) => {
      if (resp.ok) {
        const clone = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
      }
      return resp;
    }).catch(() =>
      caches.match(e.request).then((cached) => cached || caches.match("./index.html"))
    )
  );
});
