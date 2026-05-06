const CACHE_NAME = 'remindme-v1';
const STATIC_ASSETS = [
  '/index.html',
  '/manifest.json',
];

// Install - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch - serve from cache when offline, network first for API
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls - network only
  if (url.port === '3000' || url.pathname.startsWith('/auth') || url.pathname.startsWith('/reminders')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'You are offline. Please check your connection.' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Static assets - cache first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      });
    }).catch(() => caches.match('/index.html'))
  );
});

// Push notifications
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'RemindMe';
  const options = {
    body: data.body || 'You have a reminder!',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    data: data,
    actions: [
      { action: 'complete', title: '✅ Mark Done' },
      { action: 'snooze', title: '⏰ Snooze 10min' }
    ]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'complete') {
    // Handle complete action
    self.clients.openWindow('/index.html#complete-' + (event.notification.data.id || ''));
  } else {
    self.clients.openWindow('/index.html');
  }
});
