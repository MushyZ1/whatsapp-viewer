// Service Worker for Offline Support
// IMPORTANT: Place this file in public/ folder, NOT src/!

const CACHE_NAME = 'whatsapp-viewer-v1';
const STATIC_CACHE = 'static-v1';
const API_CACHE = 'api-v1';

const STATIC_FILES = [
  '/',
  '/index.html',
];

self.addEventListener('install', (event) => {
  console.log('🔧 Service Worker: Installing...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_FILES).catch(() => console.warn('Some files failed to cache')))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  console.log('🔧 Service Worker: Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== STATIC_CACHE && cacheName !== API_CACHE) {
            return caches.delete(cacheName);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API requests - network first, cache fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (request.method === 'GET' && response.ok) {
            const responseToCache = response.clone();
            caches.open(API_CACHE).then((cache) => cache.put(request, responseToCache));
          }
          return response;
        })
        .catch(() => 
          caches.match(request).then((cachedResponse) =>
            cachedResponse || new Response(
              JSON.stringify({ error: 'Offline' }),
              { status: 503, headers: { 'Content-Type': 'application/json' } }
            )
          )
        )
    );
    return;
  }

  // Static files - cache first
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      
      return fetch(request).then((response) => {
        if (response.ok) {
          const responseToCache = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, responseToCache));
        }
        return response;
      });
    })
  );
});
