import { buildPushPayload, type PushSubscription } from '@block65/webcrypto-web-push'

/**
 * Fila burra de lembretes. O servidor não sabe o que é fatura, parcela ou
 * orçamento: o aparelho calcula tudo e manda uma lista de
 * {quando, título, texto}. O cron diário só olha a data e dispara.
 */

export interface Env {
  REMINDERS: KVNamespace
  VAPID_PUBLIC_KEY: string
  VAPID_PRIVATE_KEY: string
  VAPID_SUBJECT: string
  APP_KEY: string
  ALLOWED_ORIGIN: string
}

export interface Reminder {
  id: string
  sendAt: string // YYYY-MM-DD, no fuso do aparelho
  title: string
  body: string
}

interface Stored {
  subscription: PushSubscription
  tzOffset: number // Date.getTimezoneOffset(): minutos, invertido
  reminders: Reminder[]
  sent: string[]
}

/** Lembrete mais velho que isto não dispara mais: o aviso perdeu a validade. */
const STALE_DAYS = 3
const MAX_REMINDERS = 200

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // ALLOWED_ORIGIN aceita uma lista separada por virgula (producao + local).
    // Devolve a origem que bateu, nunca a lista inteira: o cabecalho CORS so
    // admite um valor.
    const permitidas = (env.ALLOWED_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean)
    const pedida = req.headers.get('origin') ?? ''
    const origin = permitidas.includes(pedida) ? pedida : (permitidas[0] ?? '*')
    const cors = {
      'access-control-allow-origin': origin,
      vary: 'origin',
      'access-control-allow-headers': 'content-type,x-app-key',
      'access-control-allow-methods': 'POST,OPTIONS',
      'access-control-max-age': '86400',
    }

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    const url = new URL(req.url)
    if (url.pathname === '/health') return json({ ok: true }, cors)

    if (req.method !== 'POST') return json({ error: 'method' }, cors, 405)
    if (req.headers.get('x-app-key') !== env.APP_KEY) return json({ error: 'auth' }, cors, 401)

    try {
      if (url.pathname === '/schedule') return await handleSchedule(req, env, cors)
      if (url.pathname === '/unsubscribe') return await handleUnsubscribe(req, env, cors)
      // Disparo externo do cron. Existe porque o Cron Trigger da Cloudflare
      // nao esta disparando nesta conta; o GitHub Actions chama isto uma vez
      // por dia. E idempotente: o `sent` no KV impede envio repetido, entao
      // se o cron nativo voltar a funcionar nada e notificado duas vezes.
      if (url.pathname === '/run') {
        const resumo = await runCron(env)
        return json({ ok: true, ...resumo }, cors)
      }
    } catch (err) {
      return json({ error: String(err) }, cors, 400)
    }
    return json({ error: 'not found' }, cors, 404)
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runCron(env))
  },
}

// ---------- HTTP ----------

async function handleSchedule(req: Request, env: Env, cors: HeadersInit) {
  const body = (await req.json()) as {
    subscription?: PushSubscription
    timezoneOffset?: number
    reminders?: Reminder[]
  }

  const sub = body.subscription
  if (!sub?.endpoint || !sub.keys?.auth || !sub.keys?.p256dh) throw new Error('subscription inválida')
  if (!enderecoDePushValido(sub.endpoint)) throw new Error('endpoint inválido')

  const reminders = (body.reminders ?? []).filter(isReminder).slice(0, MAX_REMINDERS)
  const key = await subKey(sub.endpoint)
  const prev = await env.REMINDERS.get<Stored>(key, 'json')
  const ids = new Set(reminders.map((r) => r.id))

  await env.REMINDERS.put(
    key,
    JSON.stringify({
      subscription: sub,
      tzOffset: Number.isFinite(body.timezoneOffset) ? body.timezoneOffset! : 0,
      reminders,
      // mantém o que já foi enviado, mas só dos lembretes que ainda existem
      sent: (prev?.sent ?? []).filter((id) => ids.has(id)),
    } satisfies Stored),
    { expirationTtl: 60 * 60 * 24 * 180 }, // some sozinho se o app for abandonado
  )

  return json({ ok: true, reminders: reminders.length }, cors)
}

async function handleUnsubscribe(req: Request, env: Env, cors: HeadersInit) {
  const { endpoint } = (await req.json()) as { endpoint?: string }
  if (!endpoint) throw new Error('endpoint ausente')
  await env.REMINDERS.delete(await subKey(endpoint))
  return json({ ok: true }, cors)
}

// ---------- cron ----------

/** Chave de saude: quando o cron rodou pela ultima vez e o que ele fez. */
export const HEARTBEAT_KEY = 'cron:last-run'

/**
 * Envolve o dispatch para que TODA execucao deixe rastro, inclusive as que
 * falham. Sem isto, um cron quebrado e indistinguivel de um cron que nunca
 * rodou -- e voce so descobre perdendo uma conta.
 */
async function runCron(env: Env) {
  const startedAt = new Date().toISOString()
  let result: Record<string, unknown>
  try {
    result = { ...(await dispatch(env)), ok: true }
  } catch (err) {
    result = { ok: false, erro: String(err) }
    console.error('cron falhou:', err)
  }
  const resumo = { at: startedAt, ...result }
  await env.REMINDERS.put(HEARTBEAT_KEY, JSON.stringify(resumo), {
    expirationTtl: 60 * 60 * 24 * 30,
  }).catch((err) => console.error('nao consegui gravar o heartbeat:', err))
  return resumo
}

async function dispatch(env: Env) {
  const vapid = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  }

  if (!vapid.publicKey || !vapid.privateKey) {
    console.error('cron abortado: VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não configuradas')
    return { subs: 0, sent: 0, failed: 0, erro: 'VAPID ausente' }
  }

  let subs = 0
  let sentCount = 0
  let failed = 0

  let cursor: string | undefined
  do {
    const page = await env.REMINDERS.list({ prefix: 'sub:', cursor })
    for (const { name } of page.keys) {
      const stored = await env.REMINDERS.get<Stored>(name, 'json')
      if (!stored) continue
      subs++

      const localDate = dateInZone(new Date(), stored.tzOffset)
      const sent = new Set(stored.sent)
      const { fire, skip } = selectDue(stored.reminders, sent, localDate)
      const changed = fire.length > 0 || skip.length > 0
      let gone = false

      // marca antes de enviar: melhor perder um aviso do que repetir todo dia
      for (const r of [...fire, ...skip]) sent.add(r.id)

      for (const r of fire) {
        // um envio que falha não pode derrubar o resto da fila
        const status = await send(stored.subscription, r, vapid).catch((err) => {
          console.error(`falha ao enviar ${r.id}:`, err)
          return 0
        })
        if (status >= 200 && status < 300) sentCount++
        else {
          failed++
          console.error(`push ${r.id} recusado: HTTP ${status}`)
        }
        if (status === 404 || status === 410) {
          // inscrição morta (app desinstalado, dados limpos): para de tentar
          gone = true
          break
        }
      }

      if (gone) await env.REMINDERS.delete(name)
      else if (changed)
        await env.REMINDERS.put(name, JSON.stringify({ ...stored, sent: [...sent] } satisfies Stored), {
          expirationTtl: 60 * 60 * 24 * 180,
        })
    }
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)

  console.log(`cron: ${subs} inscrição(ões), ${sentCount} enviado(s), ${failed} falha(s)`)
  return { subs, sent: sentCount, failed }
}

/**
 * O que disparar hoje. `fire` vai virar notificação; `skip` só é marcado como
 * visto — são lembretes velhos demais, de quando o aparelho passou dias sem
 * rede. Avisar que uma conta venceu há uma semana não ajuda ninguém.
 */
export function selectDue(reminders: Reminder[], sent: Set<string>, localDate: string) {
  const floor = shiftDate(localDate, -STALE_DAYS)
  const fire: Reminder[] = []
  const skip: Reminder[] = []
  for (const r of reminders) {
    if (sent.has(r.id) || r.sendAt > localDate) continue
    ;(r.sendAt < floor ? skip : fire).push(r)
  }
  return { fire, skip }
}

async function send(
  subscription: PushSubscription,
  r: Reminder,
  vapid: { subject: string; publicKey: string; privateKey: string },
): Promise<number> {
  const payload = await buildPushPayload(
    { data: { title: r.title, body: r.body, tag: r.id, url: '#/contas' }, options: { ttl: 86400 } },
    subscription,
    vapid,
  )
  const res = await fetch(subscription.endpoint, payload)
  return res.status
}

// ---------- utilidades ----------

/**
 * So os servicos de push dos navegadores. Sem esta lista, qualquer um com a
 * APP_KEY (que viaja no bundle do site, entao e publica na pratica) poderia
 * cadastrar um endpoint arbitrario e usar o cron como amplificador de
 * requisicoes contra terceiros.
 */
const HOSTS_DE_PUSH = [
  'fcm.googleapis.com', // Chrome, Edge, Android
  'updates.push.services.mozilla.com', // Firefox
  'web.push.apple.com', // Safari, iOS
  'notify.windows.com', // Windows legado
  'push.services.mozilla.com',
]

export function enderecoDePushValido(endpoint: string) {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  return HOSTS_DE_PUSH.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))
}

function isReminder(r: unknown): r is Reminder {
  const x = r as Reminder
  return (
    !!x &&
    typeof x.id === 'string' &&
    typeof x.title === 'string' &&
    typeof x.body === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(x.sendAt) &&
    x.title.length <= 120 &&
    x.body.length <= 200
  )
}

/** O endpoint é longo e secreto; a chave do KV é só o hash dele. */
async function subKey(endpoint: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `sub:${hex.slice(0, 32)}`
}

/** 'YYYY-MM-DD' no fuso do aparelho, a partir do offset que ele mandou. */
export function dateInZone(now: Date, tzOffsetMinutes: number) {
  return new Date(now.getTime() - tzOffsetMinutes * 60_000).toISOString().slice(0, 10)
}

export function shiftDate(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

const json = (body: unknown, cors: HeadersInit, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  })
