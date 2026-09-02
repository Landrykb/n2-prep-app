const CACHE_NAME = 'jpn2easy-v1'
const PRECACHE = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  if (event.request.url.startsWith('https://')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached
        return fetch(event.request)
          .then((res) => {
            const clone = res.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
            return res
          })
          .catch(() => caches.match('/index.html'))
      })
    )
  }
})

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {}
  const title = data.title || 'Time to study N2!'
  const options = {
    body: data.body || 'Keep your streak alive — do a quick drill or review your deck.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'study-reminder',
    data: { url: data.url || '/' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const client = clients.find((c) => c.url === url && 'focus' in c)
      if (client) return client.focus()
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})
