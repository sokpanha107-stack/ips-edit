const CACHE_NAME = 'ips-edit-shell-v5';
const APP_SHELL = ['/manifest.json', '/icon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/apple-touch-icon-dark.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Pages and app code: network first (always the newest deploy), cache only as offline fallback.
// Static icons/images: cache first.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  // Never cache account data: API answers, login and auth pages stay out of the offline cache.
  if (/^\/(api|auth|login)(\/|$)/.test(new URL(request.url).pathname)) return;
  const isStatic = /\.(png|svg|ico|woff2?)$/.test(new URL(request.url).pathname);
  if (isStatic) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      return response;
    })));
    return;
  }
  event.respondWith(fetch(request).then((response) => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)); }
    return response;
  }).catch(() => caches.match(request).then((cached) => cached || caches.match('/'))));
});

// ---- Web Push: show a native notification when a job finishes (sent by the server with the web-push library) ----
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Atom Edit', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Atom Edit';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'ips-job',
    renotify: true,
    data: { url: data.url || '/' },
  }));
});

// Tapping the notification focuses the app (or opens it) on the page the job points to.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const client of list) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        if ('navigate' in client) client.navigate(target).catch(() => undefined);
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  }));
});
