const CACHE = "lifeplan-v16";
const ASSETS = ["./", "index.html", "style.css", "calc.js", "app.js", "wizard.js", "report.js", "profiles.js", "sync.js", "config.js", "report.css", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-180.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
// ネットワーク優先、失敗時にキャッシュ(更新が反映されやすく、オフラインでも動く)
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== self.location.origin) return; // 外部(サーバー)との通信は対象外
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request)));
});
