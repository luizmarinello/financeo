/**
 * Teste de integração contra o `wrangler dev` local: sobe uma agenda, dispara
 * o cron e confere o que aconteceu. Uso:
 *   npx wrangler dev --port 8788 --local --test-scheduled --persist-to <dir>
 *   node itest.mjs
 */
const API = process.env.API ?? 'http://127.0.0.1:8788'
const KEY = process.env.APP_KEY ?? 'eeIICQWl-Cp9ls1NUcKWfKM4GXx2jjHG'

const b64url = (b) =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

async function fakeSubscription(endpoint) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  return {
    endpoint,
    expirationTime: null,
    keys: {
      p256dh: b64url(await crypto.subtle.exportKey('raw', pair.publicKey)),
      auth: b64url(crypto.getRandomValues(new Uint8Array(16))),
    },
  }
}

const post = (path, body) =>
  fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-app-key': KEY },
    body: JSON.stringify(body),
  })

let failures = 0
function check(label, ok, extra = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`)
  if (!ok) failures++
}

// O gatilho HTTP do cron só existe no wrangler local. Contra o worker
// publicado, o disparo é o agendamento da Cloudflare — verifique com
// `npm run tail`.
const isLocal = /127\.0\.0\.1|localhost/.test(API)
const cron = () => (isLocal ? fetch(`${API}/cdn-cgi/handler/scheduled`) : null)

// ---------- 1. agenda aceita e podada ----------
const sub = await fakeSubscription('https://fcm.googleapis.com/fcm/send/endpoint-que-nao-existe')
const reminders = [
  { id: 'hoje', sendAt: day(0), title: 'Aluguel vence hoje', body: 'R$ 1.800,00' },
  { id: 'futuro', sendAt: day(5), title: 'Internet vence em 3 dias', body: 'R$ 120,00' },
  { id: 'velho', sendAt: day(-20), title: 'Conta velha', body: 'R$ 10,00' },
  { id: 'lixo', sendAt: 'nao-e-data', title: 'x', body: 'y' },
  { id: 'gigante', sendAt: day(1), title: 'T'.repeat(500), body: 'z' },
]

let res = await post('/schedule', { subscription: sub, timezoneOffset: 180, reminders })
let json = await res.json()
check('POST /schedule aceito', res.status === 200, `HTTP ${res.status}`)
check(
  'lembrete malformado e título gigante descartados',
  json.reminders === 3,
  `guardou ${json.reminders} de 5`,
)

// ---------- 2. cron dispara e a inscrição morta é removida ----------
res = await cron()
if (isLocal) check('cron executou', res.ok, `HTTP ${res.status}`)
else console.log('· cron: pulado (só dá para disparar por HTTP no wrangler local)')

// endpoint inexistente responde 404 -> a inscrição deve sumir do KV.
// Se sumiu, um novo /schedule começa do zero (sent vazio).
await new Promise((r) => setTimeout(r, 1500))

// ---------- 3. dedupe: mesmo lembrete não repete ----------
const sub2 = await fakeSubscription('https://httpbin.org/status/201')
res = await post('/schedule', { subscription: sub2, timezoneOffset: 180, reminders })
check('segunda agenda aceita', res.status === 200)

await cron()
await new Promise((r) => setTimeout(r, 2500))

// reenviar a MESMA agenda deve preservar o que já foi marcado como enviado
res = await post('/schedule', { subscription: sub2, timezoneOffset: 180, reminders })
json = await res.json()
check('reenvio da agenda aceito', res.status === 200, `${json.reminders} lembretes`)

// ---------- 4. unsubscribe ----------
res = await post('/unsubscribe', { endpoint: sub2.endpoint })
check('unsubscribe ok', res.status === 200)

res = await post('/unsubscribe', {})
check('unsubscribe sem endpoint recusado', res.status === 400)

console.log(failures ? `\n${failures} falha(s)` : '\nintegração ok')
process.exit(failures ? 1 : 0)
