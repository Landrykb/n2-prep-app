const CACHE_NAME = 'yonde-v7'
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
  const isCall = data.kind === 'yobidashi-call'
  const title = data.title || (isCall ? '呼び出しの時間 — Yobidashi no Jikan' : 'Yonde — a light few minutes, when you are ready')
  const options = {
    body: data.body || (isCall
      ? 'You are being summoned — a few minutes of spoken Japanese with your sensei.'
      : 'Your fleet kept today small on purpose. One short session is waiting whenever you are — no pile, no pressure.'),
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || (isCall ? 'yobidashi-call' : 'study-reminder'),
    // The slot context rides along so a tap can open the ringing screen for
    // THIS slot (see notificationclick + SenseiCall's incoming-call intake).
    data: {
      url: data.url || '/',
      kind: data.kind || null,
      slotId: data.slotId || null,
      slotDate: data.slotDate || null,
      slotIdx: data.slotIdx ?? null,
    },
  }
  // A summons should behave like a call arriving, not a silent badge:
  // re-alert and stay until the learner answers or dismisses it. Ordinary
  // reminders keep the default gentle behaviour.
  if (isCall) {
    options.renotify = true
    options.requireInteraction = true
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  const url = data.url || '/'
  const isCall = data.kind === 'yobidashi-call'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const appClient = clients.find((c) => new URL(c.url).origin === self.location.origin && 'focus' in c)
      if (appClient) {
        if (isCall) {
          // Hand the slot to the running app: App.jsx stashes it and routes
          // to the Yobidashi screen, which starts the ring for that slot.
          appClient.postMessage({
            type: 'yobidashi-call',
            slotId: data.slotId,
            slotDate: data.slotDate,
            slotIdx: data.slotIdx,
            url,
          })
        } else if (new URL(appClient.url).hash !== new URL(url, self.location.origin).hash) {
          appClient.navigate(url).catch(() => {})
        }
        return appClient.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})
