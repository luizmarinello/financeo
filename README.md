# Finanças

PWA de controle financeiro pessoal. Os dados ficam no aparelho (IndexedDB); o
servidor só existe para entregar lembrete de vencimento com o app fechado.

## Rodar local

```bash
npm install
npm run dev
```

`npm run check` roda os asserts da lógica de negócio (ciclo de fatura, divisão de
parcelas, orçamento, previsão). Rode antes de cada commit.

### Testar o push sem publicar nada

```bash
cd worker
npm install
npm run genkeys                 # copie a saída para worker/.dev.vars e para ../.env.local
npm run check                   # asserts: o que dispara no dia + criptografia do payload
npm run dev                     # wrangler local, porta 8788
node itest.mjs                  # em outro terminal: bate no worker de verdade
```

`itest.mjs` sobe uma agenda com lembrete de hoje, futuro e vencido, dispara o
cron e confere o que saiu. O log do `wrangler` mostra a linha
`cron: N inscrição(ões), N enviado(s), N falha(s)` — é por ela que você
descobre se algo quebrou em produção (`npm run tail`).

No Windows, se o `workerd` reclamar de `SQLITE_CANTOPEN`, rode com
`--persist-to` apontando para uma pasta fora do projeto.

## Estrutura

```
src/
  db.ts              schema Dexie + tipos + categorias iniciais
  money.ts           centavos ↔ R$, divisão de parcelas
  dates.ts           datas como string + ciclo de fatura
  backup.ts          export/import JSON
  notify.ts          permissão, inscrição push, envio da agenda
  sw.ts              service worker (cache offline + handler de push)
  finance/           regra de negócio pura, sem React
    tx.ts            criar/apagar lançamento (materializa parcelas)
    balance.ts       saldo por forma de pagamento
    invoice.ts       fatura do cartão
    budget.ts        orçamento por categoria
    goals.ts         metas e sugestão de sobra
    forecast.ts      previsão de 3 meses
    schedule.ts      agenda de lembretes
    suggest.ts       categoria/valor sugeridos pelo histórico
    selfcheck.ts     os asserts
  routes/            uma tela por arquivo
  components/ui.tsx  peças reutilizadas
worker/
  src/index.ts       fila de lembretes + cron diário
  selfcheck.ts       asserts do worker
  itest.mjs          teste de integração contra o wrangler local
  genkeys.mjs        gera as chaves VAPID
```

## Decisões que valem saber

**Dinheiro é inteiro em centavos.** Data é `'YYYY-MM-DD'` como string. Nada de
float, nada de `Date` no banco: ordena e compara direto, sem bug de fuso.

**Parcela é materializada.** Uma compra em 10x vira 10 transações com o mesmo
`purchaseId`. Fatura, previsão e histórico viram a mesma query simples. Apagar
uma parcela apaga as dez.

**Compra no cartão não tira do saldo na hora.** Ela entra na fatura. O que tira
é o pagamento da fatura, registrado na tela do cartão. Por isso "Marcar paga"
importa: sem isso a previsão não sabe que o dinheiro saiu.

**Orçamento é uma linha por categoria, não por mês.** Como o limite renova igual
e não acumula, não existe estado mensal para guardar — o gasto é sempre
calculado do histórico.

**Aporte em meta é uma transação com `goalId`.** Não conta como gasto do mês nem
consome orçamento.

## Notificações

Duas famílias, e elas são diferentes:

| | Quando dispara | Precisa de servidor |
|---|---|---|
| Orçamento estourado / perto do limite | no instante do lançamento, app aberto | **não** |
| Conta ou fatura a vencer | dias antes, app fechado | sim |

O alerta de orçamento é local (`registration.showNotification`). Só o lembrete
de vencimento sobe para o servidor, e sobe apenas como `{sendAt, title, body}` —
nome, valor e data da conta. Nenhum histórico, categoria, saldo ou fatura sai do
aparelho. Dá para conferir o que vai subir em **Ajustes → Próximos lembretes**.

O app recalcula a agenda dos próximos 3 meses e manda a lista inteira sempre que
algo muda. O servidor não sabe o que mudou, só qual é a lista atual.

**iPhone:** Web Push exige iOS 16.4+ **e** o app adicionado à tela inicial.
Aberto no Safari sem instalar, não chega nada. Android/Chrome não tem essa
restrição.

## Publicar o frontend no GitHub Pages

1. Crie o repositório e ajuste `base` em `vite.config.ts` para `/<nome-do-repo>/`
   (está em `/financas/`). Se for um repositório `usuario.github.io`, use `'/'`.
2. `git push` para `main`.
3. No GitHub: **Settings → Pages → Source: GitHub Actions**.
4. O workflow em `.github/workflows/deploy.yml` faz o build e publica a cada push.

As variáveis do push vão em **Settings → Secrets and variables → Actions →
Variables** (não são segredos — a chave VAPID pública e a URL do worker ficam
visíveis no bundle de qualquer jeito):

- `VITE_PUSH_API`
- `VITE_VAPID_PUBLIC_KEY`
- `VITE_PUSH_KEY`

E um **secret** (esse sim é segredo, não vai para o bundle): `PUSH_APP_KEY`,
usado pelo workflow que dispara os lembretes.

Sem elas o app publica e funciona inteiro, menos o lembrete com o app fechado.

## Backend de notificações

**Já está no ar:** `https://financas-push.luizmarinello.workers.dev`
(worker `financas-push`, KV `REMINDERS`).

Para republicar depois de mexer no código: `cd worker && npm run deploy`.
Para ver o que aconteceu: `npm run tail`.

### O disparo diário NÃO usa o cron da Cloudflare

O Cron Trigger desta conta não dispara. O agendamento aparece registrado na API
(`/workers/scripts/financas-push/schedules` devolve o cron corretamente), mas
nenhuma execução acontece: com `* * * * *` configurado, zero invocações em mais
de 35 minutos, confirmado por três caminhos independentes (o `wrangler tail`
nunca registrou evento de cron, o KV nunca mudou, e o GraphQL de invocações só
mostrou as chamadas HTTP feitas na mão).

O disparo real vem do **GitHub Actions** chamando `POST /run` no worker, em
[.github/workflows/lembretes.yml](.github/workflows/lembretes.yml). `/run` faz
exatamente o que o `scheduled()` faria.

O bloco `[triggers]` continua no `wrangler.toml` de propósito. Se a Cloudflare
voltar a funcionar, os dois rodando juntos **não duplicam nada**: o campo `sent`
no KV marca cada lembrete antes de enviar, então a segunda execução do dia
devolve `sent: 0`.

Configure no repositório:

| Onde | Nome | Valor |
|---|---|---|
| Secrets → Actions | `PUSH_APP_KEY` | o `APP_KEY` (o mesmo de `worker/.dev.vars`) |
| Variables → Actions | `VITE_PUSH_API` | a URL do worker |

Para conferir se o último disparo funcionou, sem abrir o painel:

```bash
cd worker
npx wrangler kv key get "cron:last-run" --namespace-id <id> --remote
```

Devolve `{"at":"...","subs":N,"sent":N,"failed":N,"ok":true}`. É gravado em toda
execução, inclusive nas que falham — sem isso, um disparo quebrado seria
indistinguível de um que nunca rodou, e você só descobriria perdendo uma conta.

**Nota do GitHub Actions:** workflows agendados são desativados automaticamente
após 60 dias sem commits no repositório. Se parar de receber lembrete, é o
primeiro lugar para olhar.

### Refazer do zero em outra conta

Precisa de conta na Cloudflare (plano gratuito, sem cartão).

```bash
cd worker
npm install
npm run genkeys          # imprime VAPID + APP_KEY; guarde a saída
npx wrangler login
npx wrangler kv namespace create REMINDERS
```

Cole o `id` que o comando devolveu em `wrangler.toml`, e ajuste `VAPID_SUBJECT`
(seu e-mail) e `ALLOWED_ORIGIN` (`https://SEU-USUARIO.github.io`).

```bash
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put APP_KEY
npm run deploy
```

O deploy imprime a URL (`https://financas-push.SEU-SUBDOMINIO.workers.dev`).
Coloque ela em `VITE_PUSH_API`, junto com `VITE_VAPID_PUBLIC_KEY` e
`VITE_PUSH_KEY`, no `.env.local` (local) e nas Variables do repositório (Pages).

Três armadilhas que já custaram tempo aqui:

- **Subdomínio workers.dev.** Na primeira vez a conta não tem um. O deploy
  avisa no meio da saída e a URL simplesmente não responde. Registre em
  *Workers & Pages → Subdomain* no painel, e espere alguns minutos: o
  certificado demora a ser emitido e até lá o TLS falha com `alert 40`.
- **Não use `valor | wrangler secret put NOME` no PowerShell.** O pipe gruda
  um `
` no fim e o segredo fica diferente do arquivo — o worker devolve 401
  sem explicar por quê. Use `wrangler secret bulk` com um JSON.
- **`npm run genkeys -- --write`** grava as chaves direto nos arquivos sem
  imprimir a privada. Prefira essa forma se alguém (ou algum agente) estiver
  lendo o terminal.

O cron roda às 12:00 UTC (09:00 em Brasília). Para mudar, edite `crons` em
`wrangler.toml`. `npm run tail` mostra os logs ao vivo.

### O que o Worker guarda

Uma entrada de KV por aparelho: a inscrição de push, o fuso e a lista de
lembretes. Expira sozinha em 180 dias sem uso. **Ajustes → Desativar** apaga a
entrada no servidor e cancela a inscrição.

## Backup

Tudo vive no IndexedDB deste navegador. Limpar os dados do site apaga o
histórico. **Ajustes → Exportar JSON** de vez em quando; importar substitui tudo.
