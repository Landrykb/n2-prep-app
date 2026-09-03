const CACHE_NAME = 'jpn2easy-v3'
const PRECACHE = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
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

async function networkFirst(request, cache) {
  try {
    const networkResponse = await fetch(request)
    if (networkResponse && networkResponse.status === 200) {
      cache.put(request, networkResponse.clone())
    }
    return networkResponse
  } catch {
    const cached = await cache.match(request)
    if (cached) return cached
    throw new Error('Network error and no cache for ' + request.url)
  }
}

async function cacheFirst(request, cache) {
  const cached = await cache.match(request)
  if (cached) return cached
  const networkResponse = await fetch(request)
  if (networkResponse && networkResponse.status === 200) {
    cache.put(request, networkResponse.clone())
  }
  return networkResponse
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return

  const isHtml = url.pathname === '/' || url.pathname.endsWith('.html')
  const isManifest = url.pathname.endsWith('.webmanifest')
  const isIcon = url.pathname.match(/\/(icon|favicon|apple-touch-icon)/)

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      if (isHtml || isManifest) return networkFirst(event.request, cache)
      if (isIcon || url.pathname.startsWith('/assets/') || url.pathname.startsWith('/data/')) return cacheFirst(event.request, cache)
      return networkFirst(event.request, cache)
    })
  )
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
