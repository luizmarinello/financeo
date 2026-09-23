/**
 * Gera o par de chaves VAPID (P-256, base64url) e uma APP_KEY aleatória.
 *
 *   npm run genkeys            imprime as chaves no terminal
 *   npm run genkeys -- --write grava direto em worker/.dev.vars e ../.env.local
 *                              sem imprimir a privada (use quando alguém
 *                              estiver olhando o terminal, ou um agente)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify',
])

const publicKey = b64url(await crypto.subtle.exportKey('raw', pair.publicKey))
const { d: privateKey } = await crypto.subtle.exportKey('jwk', pair.privateKey)
const appKey = b64url(crypto.getRandomValues(new Uint8Array(24)))

if (!process.argv.includes('--write')) {
  console.log(`
VAPID_PUBLIC_KEY   ${publicKey}
VAPID_PRIVATE_KEY  ${privateKey}
APP_KEY            ${appKey}

No worker (uma vez cada):
  npx wrangler secret put VAPID_PUBLIC_KEY
  npx wrangler secret put VAPID_PRIVATE_KEY
  npx wrangler secret put APP_KEY

No frontend, em .env.local (a pública pode ir para o repositório):
  VITE_VAPID_PUBLIC_KEY=${publicKey}
  VITE_PUSH_KEY=${appKey}
  VITE_PUSH_API=https://financas-push.SEU-SUBDOMINIO.workers.dev
`)
  process.exit(0)
}

// --write: preserva o que já existe nos arquivos, troca só as três chaves
const subject = readValue('.dev.vars', 'VAPID_SUBJECT') ?? 'mailto:voce@exemplo.com'
const origin = readValue('.dev.vars', 'ALLOWED_ORIGIN') ?? 'http://localhost:5178'
const api = readValue('../.env.local', 'VITE_PUSH_API') ?? 'http://127.0.0.1:8788'

writeFileSync(
  '.dev.vars',
  `# Segredos do \`wrangler dev\` local. NÃO vai para o git.
# Os mesmos valores estão nos secrets do worker publicado.
VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
APP_KEY=${appKey}
VAPID_SUBJECT=${subject}
ALLOWED_ORIGIN=${origin}
`,
)

writeFileSync(
  '../.env.local',
  `# Não vai para o git. No GitHub Pages estes valores vão em
# Settings > Secrets and variables > Actions > Variables.
VITE_PUSH_API=${api}
VITE_VAPID_PUBLIC_KEY=${publicKey}
VITE_PUSH_KEY=${appKey}
`,
)

console.log(`✓ worker/.dev.vars e .env.local gravados
  chave pública VAPID: ${publicKey}
  a privada e a APP_KEY ficaram só nos arquivos, não foram impressas`)

function readValue(file, key) {
  if (!existsSync(file)) return null
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${key}=`))
  return line ? line.slice(key.length + 1).trim() : null
}
