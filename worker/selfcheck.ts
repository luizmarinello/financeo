/**
 * Check do worker: a decisÃ£o de "o que disparar hoje" e a montagem do payload
 * criptografado (VAPID + aes128gcm). Roda com `npm run check` dentro de worker/.
 */
import assert from 'node:assert/strict'
import { buildPushPayload } from '@block65/webcrypto-web-push'
import { dateInZone, enderecoDePushValido, selectDue, shiftDate, type Reminder } from './src/index.js'

const r = (id: string, sendAt: string): Reminder => ({ id, sendAt, title: id, body: 'x' })

// ---------- datas ----------
assert.equal(shiftDate('2026-03-01', -3), '2026-02-26')
assert.equal(shiftDate('2026-01-01', -1), '2025-12-31')

// BrasÃ­lia Ã© UTC-3, entÃ£o getTimezoneOffset() devolve 180.
// 02:00 UTC do dia 5 ainda Ã© dia 4 lÃ¡.
assert.equal(dateInZone(new Date('2026-03-05T02:00:00Z'), 180), '2026-03-04')
assert.equal(dateInZone(new Date('2026-03-05T12:00:00Z'), 180), '2026-03-05')
// e o cron das 12:00 UTC cai no dia certo o ano todo
assert.equal(dateInZone(new Date('2026-12-31T12:00:00Z'), 180), '2026-12-31')

// ---------- endpoints aceitos ----------
// O app e publico e a APP_KEY viaja no bundle, entao esta lista e o que
// impede o worker de virar amplificador de requisicao contra terceiros.
for (const bom of [
  'https://fcm.googleapis.com/fcm/send/abc',
  'https://updates.push.services.mozilla.com/wpush/v2/abc',
  'https://web.push.apple.com/abc',
  'https://xyz.notify.windows.com/w/?token=abc',
]) {
  assert.equal(enderecoDePushValido(bom), true, `deveria aceitar ${bom}`)
}
for (const ruim of [
  'https://exemplo.com/webhook',
  'http://fcm.googleapis.com/fcm/send/abc', // sem TLS
  'https://fcm.googleapis.com.invasor.net/abc', // sufixo enganoso
  'https://interno.local/admin',
  'nao-e-url',
]) {
  assert.equal(enderecoDePushValido(ruim), false, `deveria recusar ${ruim}`)
}

// ---------- o que dispara ----------
const hoje = '2026-03-10'
const agenda = [
  r('futuro', '2026-03-11'),
  r('hoje', '2026-03-10'),
  r('ontem', '2026-03-09'),
  r('limite', '2026-03-07'), // exatamente STALE_DAYS atrÃ¡s: ainda vale
  r('velho', '2026-03-06'), // um dia alÃ©m: sÃ³ marca como visto
]

{
  const { fire, skip } = selectDue(agenda, new Set(), hoje)
  assert.deepEqual(fire.map((x) => x.id), ['hoje', 'ontem', 'limite'])
  assert.deepEqual(skip.map((x) => x.id), ['velho'], 'lembrete vencido hÃ¡ dias nÃ£o vira notificaÃ§Ã£o')
  assert.ok(!fire.some((x) => x.id === 'futuro'), 'nada dispara antes da hora')
}

{
  // jÃ¡ enviado nÃ£o repete no dia seguinte
  const { fire } = selectDue(agenda, new Set(['hoje', 'ontem', 'limite']), hoje)
  assert.deepEqual(fire, [], 'roda de novo no mesmo dia e nÃ£o manda nada')
}

{
  // aparelho passou 5 dias sem rede: recupera o recente, descarta o antigo
  const { fire, skip } = selectDue(agenda, new Set(), '2026-03-10')
  assert.equal(fire.length + skip.length, 4)
}

// ---------- payload criptografado ----------
{
  // inscriÃ§Ã£o sintÃ©tica, mas com chaves de verdade: Ã© o que o navegador manda
  const client = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const p256dh = b64url(await crypto.subtle.exportKey('raw', client.publicKey))
  const auth = b64url(crypto.getRandomValues(new Uint8Array(16)))

  const vapidPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
  ])
  const publicKey = b64url(await crypto.subtle.exportKey('raw', vapidPair.publicKey))
  const { d: privateKey } = await crypto.subtle.exportKey('jwk', vapidPair.privateKey)

  const payload = await buildPushPayload(
    { data: { title: 'Aluguel vence em 3 dias', body: 'R$ 1.800,00' }, options: { ttl: 86400 } },
    { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', expirationTime: null, keys: { auth, p256dh } },
    { subject: 'mailto:teste@exemplo.com', publicKey, privateKey },
  )

  assert.equal(payload.method.toUpperCase(), 'POST')
  assert.match(payload.headers.authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/, 'JWT VAPID assinado')
  assert.equal(payload.headers['content-encoding'], 'aes128gcm')
  assert.ok(payload.body.byteLength > 100, 'corpo criptografado nÃ£o Ã© vazio')
  assert.ok(
    !new TextDecoder().decode(payload.body).includes('Aluguel'),
    'o texto NÃƒO viaja em claro â€” sÃ³ o navegador dono da chave consegue ler',
  )
}

function b64url(buf: ArrayBuffer | Uint8Array) {
  return Buffer.from(buf as ArrayBuffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

console.log('âœ“ worker: todos os checks passaram')

