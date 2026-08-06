/* FOSSStudio service worker: offline shell + push notifications.
   Live sessions always need the network, so requests pass straight
   through; only static shell files are cached as a fallback. */
const CACHE = "fossstudio-v2";
const SHELL = ["/", "/host/host.css", "/fonts/Manrope.woff2"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(Promise.all([
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ),
    self.clients.claim()
  ]));
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

self.addEventListener("push", (e) => {
  const data = e.data ? e.data.json() : { title: "FOSSStudio", body: "" };
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png"
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(clients.openWindow("/host/"));
});
