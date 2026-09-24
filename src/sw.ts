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

/**
 * Recebe arquivo vindo do "Compartilhar" do Android (Web Share Target).
 *
 * O destino declarado no manifest é um POST, que não existe no GitHub Pages:
 * quem responde é este handler, antes de ir para a rede. Ele guarda o conteúdo
 * num cache temporário e redireciona para a tela de importar, que mostra o que
 * veio e pede confirmação — importar substitui todos os dados, então nada aqui
 * grava nada sozinho.
 */
const CACHE_COMPARTILHADO = 'financeo-compartilhado'
const ARQUIVO_COMPARTILHADO = 'arquivo-recebido'

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  const ehCompartilhamento =
    event.request.method === 'POST' && url.pathname.endsWith('/importar')
  if (!ehCompartilhamento) return

  event.respondWith(
    (async () => {
      const destino = new URL(self.registration.scope)
      try {
        const form = await event.request.formData()
        const arquivo = form.get('arquivo')
        if (!(arquivo instanceof File)) throw new Error('sem arquivo')

        const cache = await caches.open(CACHE_COMPARTILHADO)
        await cache.put(
          ARQUIVO_COMPARTILHADO,
          new Response(await arquivo.text(), {
            headers: { 'content-type': 'application/json', 'x-nome': arquivo.name || 'backup.json' },
          }),
        )
        destino.hash = '#/importar'
      } catch {
        destino.hash = '#/importar?erro=1'
      }
      // 303: o navegador troca o POST por um GET na tela de destino
      return Response.redirect(destino.href, 303)
    })(),
  )
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
