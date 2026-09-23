/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

// Tudo que o build gerou fica em cache: o app abre e funciona offline.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

interface PushPayload {
  title?: string
  body?: string
  tag?: string
  url?: string
}

self.addEventListener('push', (event) => {
  let data: PushPayload = {}
  try {
    data = event.data?.json() ?? {}
  } catch {
    data = { body: event.data?.text() }
  }

  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Finanças', {
      body: data.body ?? '',
      tag: data.tag,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: data.url ?? '#/contas' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data as { url?: string })?.url ?? '#/'

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      // app já aberto: traz para a frente em vez de abrir outra aba
      for (const client of clients) {
        if ('focus' in client) {
          await client.focus()
          client.postMessage({ type: 'navigate', url: target })
          return
        }
      }
      await self.clients.openWindow(new URL(target, self.registration.scope).href)
    })(),
  )
})
