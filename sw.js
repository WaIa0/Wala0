/* Office Run service worker — cache-first for full offline play. */
const CACHE = "office-run-v3";
const ASSETS = [
  ".",
  "index.html",
  "style.css",
  "game.js",
  "revive.js",
  "site.webmanifest",
  "assets/office_bg.png",
  "assets/runner_base.png",
  "assets/runner_jump.png",
  "assets/runner_slide.png",
  "assets/runner_run_0.png",
  "assets/runner_run_1.png",
  "assets/runner_run_2.png",
  "assets/runner_run_3.png",
  "assets/icon-192.png",
  "assets/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // never cache the leaderboard API — always live
  if (new URL(e.request.url).pathname.includes("/api/")) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(e.request).then((resp) => {
          if (resp.ok && new URL(e.request.url).origin === self.location.origin) {
            const copy = resp.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return resp;
        })
    )
  );
});
