import { db } from './db'
import { addMonths, thisMonth } from './dates'
import { formatMoney } from './money'
import { budgetStatus, loadBudgetData, NEAR_LIMIT } from './finance/budget'
import { buildSchedule, type Reminder } from './finance/schedule'

/**
 * Duas famílias de notificação, e elas são bem diferentes:
 *
 * - Orçamento: acontece no instante em que você lança a despesa, com o app
 *   aberto. Notificação local, sem servidor nenhum no meio.
 * - Conta a vencer: precisa chegar com o app fechado. Só isso vai para o
 *   servidor, e só como {quando, título, texto}.
 */

const SETTING_ENDPOINT = 'pushEndpoint'
const SETTING_SYNCED = 'scheduleSyncedAt'
const SETTING_ALERTED = 'budgetAlerted'

export const PUSH_API = import.meta.env.VITE_PUSH_API ?? ''
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''
const APP_KEY = import.meta.env.VITE_PUSH_KEY ?? ''

const headers = { 'content-type': 'application/json', 'x-app-key': APP_KEY }

export const pushConfigured = () => Boolean(PUSH_API && VAPID_PUBLIC_KEY && APP_KEY)

export const notificationsSupported = () =>
  'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window

/** iOS só entrega push se o app estiver instalado na tela inicial. */
export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches ||
  (navigator as { standalone?: boolean }).standalone === true

export const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent)

// ---------- notificação local (orçamento) ----------

async function showLocal(title: string, body: string, tag: string) {
  if (Notification.permission !== 'granted') return
  const reg = await navigator.serviceWorker.ready
  await reg.showNotification(title, { body, tag, icon: 'icon-192.png', badge: 'icon-192.png' })
}

/**
 * Chamado depois de cada lançamento. Avisa uma vez por categoria/mês/estado,
 * senão viraria spam a cada compra.
 */
export async function checkBudgetAlerts() {
  if (!notificationsSupported() || Notification.permission !== 'granted') return
  const month = thisMonth()
  const { budgets, categories, txs } = await loadBudgetData()
  const alerted = new Set(((await db.settings.get(SETTING_ALERTED))?.value as string[]) ?? [])
  let changed = false

  for (const s of budgetStatus(budgets, categories, txs, month)) {
    if (s.state === 'ok') continue
    const key = `${month}:${s.category.id}:${s.state}`
    if (alerted.has(key)) continue
    alerted.add(key)
    changed = true
    const over = s.state === 'over'
    await showLocal(
      over ? `Orçamento estourado: ${s.category.name}` : `${s.category.name} perto do limite`,
      over
        ? `${formatMoney(s.spentCents)} de ${formatMoney(s.limitCents)} — ${formatMoney(s.spentCents - s.limitCents)} acima`
        : `${formatMoney(s.spentCents)} de ${formatMoney(s.limitCents)} (${Math.round(s.ratio * 100)}%)`,
      `budget:${s.category.id}`,
    )
  }

  if (changed) {
    // guarda só o mês corrente e o anterior; o resto não serve para nada
    const floor = addMonths(month, -1)
    const keep = [...alerted].filter((k) => k.slice(0, 7) >= floor)
    await db.settings.put({ key: SETTING_ALERTED, value: keep })
  }
}

export { NEAR_LIMIT }

// ---------- push (contas a vencer) ----------

function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

/** Pede permissão e registra a inscrição no servidor. Devolve o que deu errado. */
export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  if (!notificationsSupported()) return { ok: false, reason: 'Este navegador não suporta notificações.' }
  if (isIOS() && !isStandalone())
    return { ok: false, reason: 'No iPhone, adicione o app à tela inicial antes de ativar.' }
  if (!pushConfigured()) return { ok: false, reason: 'Servidor de push não configurado (veja o README).' }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return { ok: false, reason: 'Permissão negada.' }

  const reg = await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    }))

  await db.settings.put({ key: SETTING_ENDPOINT, value: sub.endpoint })
  await syncSchedule(sub)
  return { ok: true }
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (sub) {
    await fetch(`${PUSH_API}/unsubscribe`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => {})
    await sub.unsubscribe()
  }
  await db.settings.delete(SETTING_ENDPOINT)
  await db.settings.delete(SETTING_SYNCED)
}

export async function pushEnabled() {
  if (!notificationsSupported() || Notification.permission !== 'granted') return false
  const reg = await navigator.serviceWorker.ready
  return Boolean(await reg.pushManager.getSubscription())
}

/**
 * Sobe a agenda dos próximos meses. Substitui a anterior inteira — o servidor
 * não precisa saber o que mudou, só qual é a lista atual.
 */
export async function syncSchedule(existing?: PushSubscription): Promise<Reminder[] | null> {
  if (!pushConfigured()) return null
  const reg = await navigator.serviceWorker.ready
  const sub = existing ?? (await reg.pushManager.getSubscription())
  if (!sub) return null

  const reminders = await buildSchedule()
  const res = await fetch(`${PUSH_API}/schedule`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      subscription: sub.toJSON(),
      timezoneOffset: new Date().getTimezoneOffset(),
      reminders,
    }),
  })
  if (!res.ok) throw new Error(`sync falhou: ${res.status}`)
  await db.settings.put({ key: SETTING_SYNCED, value: new Date().toISOString() })
  return reminders
}

export const lastSyncedAt = async () =>
  ((await db.settings.get(SETTING_SYNCED))?.value as string | undefined) ?? null

/**
 * Sincroniza sem travar a UI e sem estourar nada se estiver offline — a agenda
 * sobe na próxima vez que abrir com rede.
 */
export function syncScheduleSoon() {
  if (!navigator.onLine || !pushConfigured()) return
  setTimeout(() => {
    syncSchedule().catch(() => {})
  }, 1500)
}
