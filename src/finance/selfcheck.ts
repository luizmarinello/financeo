/**
 * Check único da lógica que dá para errar sem perceber: ciclo de fatura,
 * divisão de parcelas, leitura de valor digitado, orçamento e previsão.
 * Roda com `npm run check`. Sem framework, só assert.
 */
import assert from 'node:assert/strict'
import {
  addDays,
  addMonths,
  dateIn,
  daysInMonth,
  invoiceClosingDate,
  invoiceDueDate,
  invoiceFor,
} from '../dates'
import { formatMoney, parseMoney, splitInstallments } from '../money'
import { corrigirParcelas, installmentDates } from './installments'
import { budgetStatus } from './budget'
import { forecast } from './forecast'
import { balances, monthSummary, totalLiquid } from './balance'
import { goalProgress, suggestedSurplus } from './goals'
import type { Account, Budget, Category, Goal, Transaction } from '../db'

// ---------- datas ----------
assert.equal(daysInMonth('2024-02'), 29, 'fevereiro bissexto')
assert.equal(daysInMonth('2025-02'), 28)
assert.equal(dateIn('2025-02', 31), '2025-02-28', 'dia 31 em fevereiro cai no último dia')
assert.equal(dateIn('2025-01', 5), '2025-01-05')
assert.equal(addMonths('2025-12', 1), '2026-01', 'vira o ano')
assert.equal(addMonths('2025-01', -1), '2024-12')
assert.equal(addMonths('2025-01', 25), '2027-02')
assert.equal(addDays('2025-03-01', -1), '2025-02-28')
assert.equal(addDays('2024-03-01', -1), '2024-02-29')

// ---------- ciclo de fatura ----------
// Cartão fecha dia 20, vence dia 27: vencimento no MESMO mês do fechamento.
const c2027 = { closingDay: 20, dueDay: 27 }
assert.deepEqual(invoiceFor('2025-03-19', c2027), { month: '2025-03', dueDate: '2025-03-27' })
assert.deepEqual(
  invoiceFor('2025-03-20', c2027),
  { month: '2025-03', dueDate: '2025-03-27' },
  'compra NO dia do fechamento ainda entra na fatura que fecha',
)
assert.deepEqual(
  invoiceFor('2025-03-21', c2027),
  { month: '2025-04', dueDate: '2025-04-27' },
  'um dia depois do fechamento já é a fatura seguinte',
)

// Cartão fecha dia 28, vence dia 5: o vencimento VIRA o mês.
const c285 = { closingDay: 28, dueDay: 5 }
assert.deepEqual(invoiceFor('2025-03-10', c285), { month: '2025-04', dueDate: '2025-04-05' })
assert.deepEqual(invoiceFor('2025-03-29', c285), { month: '2025-05', dueDate: '2025-05-05' })
assert.equal(invoiceClosingDate('2025-04', c285), '2025-03-28', 'a fatura de abril fechou em março')
assert.equal(invoiceClosingDate('2025-03', c2027), '2025-03-20')
assert.equal(invoiceDueDate('2025-02', { dueDay: 31 }), '2025-02-28')

// ---------- dinheiro ----------
assert.equal(parseMoney('12'), 1200)
assert.equal(parseMoney('12,50'), 1250)
assert.equal(parseMoney('12.50'), 1250)
assert.equal(parseMoney('1.234,56'), 123456, 'ponto de milhar + vírgula decimal')
assert.equal(parseMoney('1,234.56'), 123456, 'formato inglês também')
assert.equal(parseMoney('R$ 1.800'), 180000, 'sem decimal = valor cheio')
assert.equal(parseMoney('0,05'), 5)
assert.equal(parseMoney(''), null)
assert.equal(parseMoney('abc'), null)
assert.equal(formatMoney(123456).replace(/ /g, ' '), 'R$ 1.234,56')

// parcela: nunca pode perder nem inventar centavo
const casos: Array<[number, number]> = [
  [10000, 3],
  [99, 4],
  [123457, 12],
  [1, 3],
  [180000, 6],
]
for (const [total, n] of casos) {
  const parts = splitInstallments(total, n)
  assert.equal(parts.length, n)
  assert.equal(parts.reduce((a, b) => a + b, 0), total, `soma das ${n} parcelas de ${total}`)
  assert.ok(Math.max(...parts) - Math.min(...parts) <= 1, 'parcelas diferem em no máximo 1 centavo')
}
assert.deepEqual(splitInstallments(10000, 3), [3334, 3333, 3333])

// ---------- datas das parcelas ----------
// Bug real: a parcela 1 usava a data da compra e as seguintes o mes da FATURA.
// Como uma compra depois do fechamento ja cai na fatura do mes seguinte, toda
// parcela apos a primeira ganhava um mes a mais e um mes inteiro ficava zerado
// no resumo de gastos.
{
  assert.deepEqual(installmentDates('2026-09-22', 3), ['2026-09-22', '2026-10-22', '2026-11-22'])
  assert.deepEqual(installmentDates('2026-09-22', 1), ['2026-09-22'])

  const doze = installmentDates('2026-09-22', 12)
  assert.equal(doze.length, 12)
  assert.equal(doze[0], '2026-09-22')
  assert.equal(doze[11], '2027-08-22', 'vira o ano sem pular mes')

  // nenhum mes repetido e nenhum buraco: e isso que o bug quebrava
  const meses = doze.map((d) => d.slice(0, 7))
  assert.equal(new Set(meses).size, 12, 'cada parcela em um mes diferente')
  for (let i = 1; i < meses.length; i++) {
    assert.equal(meses[i], addMonths(meses[i - 1], 1), `buraco entre ${meses[i - 1]} e ${meses[i]}`)
  }

  // dia 31 em mes curto encaixa no ultimo dia, sem vazar para o mes seguinte
  assert.deepEqual(installmentDates('2026-01-31', 3), ['2026-01-31', '2026-02-28', '2026-03-31'])
  assert.deepEqual(installmentDates('2024-01-31', 2), ['2024-01-31', '2024-02-29'])
}

// ---------- migracao das parcelas antigas ----------
// A v2 do banco corrige o que ficou gravado errado. A parcela 1 e a ancora:
// ela sempre teve a data certa.
{
  const parcela = (o: Partial<Transaction>): Transaction => ({
    id: `p${o.installmentN}-${o.purchaseId}`,
    type: 'expense',
    amountCents: 10000,
    categoryId: 'c1',
    accountId: 'a3',
    date: '2026-09-22',
    purchaseId: 'compra1',
    installmentOf: 3,
    ...o,
  })

  // exatamente o que o bug gravava: set, nov, dez (outubro pulado)
  const torto = [
    parcela({ installmentN: 1, date: '2026-09-22', invoiceMonth: '2026-10' }),
    parcela({ installmentN: 2, date: '2026-11-22', invoiceMonth: '2026-11' }),
    parcela({ installmentN: 3, date: '2026-12-22', invoiceMonth: '2026-12' }),
  ]
  const corr = corrigirParcelas(torto)
  assert.equal(corr.length, 2, 'so as parcelas 2 e 3 mudam')
  assert.deepEqual(
    corr.map((c) => c.para),
    ['2026-10-22', '2026-11-22'],
  )
  assert.ok(!corr.some((c) => c.id.startsWith('p1-')), 'a parcela 1 nunca e tocada')

  // rodar de novo nao muda mais nada: a migracao e idempotente
  const certo = torto.map((t) => {
    const c = corr.find((x) => x.id === t.id)
    return c ? { ...t, date: c.para } : t
  })
  assert.deepEqual(corrigirParcelas(certo), [], 'segunda passada nao mexe em nada')

  // lancamento avulso (sem purchaseId) fica de fora
  const avulso = parcela({ purchaseId: undefined, installmentN: undefined, installmentOf: undefined })
  assert.deepEqual(corrigirParcelas([avulso]), [])

  // parcela 1 apagada: sem ancora, nao da para saber a data da compra
  assert.deepEqual(
    corrigirParcelas(torto.filter((t) => t.installmentN !== 1)),
    [],
    'sem a parcela 1 o grupo fica intacto em vez de chutar',
  )

  // duas compras diferentes nao se misturam
  const outra = parcela({ purchaseId: 'compra2', installmentN: 2, date: '2026-12-05', installmentOf: 2 })
  const ancora = parcela({ purchaseId: 'compra2', installmentN: 1, date: '2026-10-05', installmentOf: 2 })
  const misto = corrigirParcelas([...torto, ancora, outra])
  assert.equal(misto.filter((c) => c.id.includes('compra2')).length, 1)
  assert.equal(misto.find((c) => c.id.includes('compra2'))!.para, '2026-11-05')
}

// ---------- fixtures ----------
const cash: Account = { id: 'a1', name: 'Espécie', kind: 'cash', openingCents: 50000, archived: 0 }
const bank: Account = { id: 'a2', name: 'Conta', kind: 'bank', openingCents: 200000, archived: 0 }
const credit: Account = { id: 'a3', name: 'Cartão', kind: 'credit', openingCents: 0, archived: 0 }
const accounts = [cash, bank, credit]

let seq = 0
const tx = (o: Partial<Transaction>): Transaction => ({
  id: `t${seq++}`,
  type: 'expense',
  amountCents: 0,
  categoryId: 'c1',
  accountId: 'a2',
  date: '2025-03-10',
  ...o,
})

// ---------- saldo ----------
{
  const txs = [
    tx({ type: 'income', amountCents: 300000, accountId: 'a2' }),
    tx({ type: 'expense', amountCents: 5000, accountId: 'a1' }),
    tx({ amountCents: 80000, accountId: 'a3', cardId: 'card1', invoiceMonth: '2025-04' }),
  ]
  const bs = balances(accounts, txs, [])
  assert.equal(bs.length, 2, 'cartão não aparece como saldo disponível')
  assert.equal(bs.find((b) => b.account.id === 'a1')!.cents, 45000)
  assert.equal(bs.find((b) => b.account.id === 'a2')!.cents, 500000)
  assert.equal(totalLiquid(bs), 545000, 'compra no cartão NÃO tira do saldo hoje')

  const pago = balances(accounts, txs, [
    {
      key: 'card1:2025-04',
      cardId: 'card1',
      invoiceMonth: '2025-04',
      paidAt: '2025-04-05',
      amountCents: 80000,
      accountId: 'a2',
    },
  ])
  assert.equal(totalLiquid(pago), 465000, 'pagar a fatura tira do saldo uma vez só')

  const s = monthSummary(txs, '2025-03')
  assert.equal(s.incomeCents, 300000)
  assert.equal(s.expenseCents, 85000, 'gasto do mês inclui o que foi no cartão')
  assert.equal(monthSummary(txs, '2025-04').expenseCents, 0, 'outro mês não vaza')
}

// ---------- orçamento ----------
{
  const cats: Category[] = [
    { id: 'c1', name: 'Alimentação', kind: 'expense', archived: 0 },
    { id: 'c2', name: 'Lazer', kind: 'expense', archived: 0 },
  ]
  const budgets: Budget[] = [
    { categoryId: 'c1', limitCents: 50000 },
    { categoryId: 'c2', limitCents: 20000 },
  ]
  const txs = [
    tx({ categoryId: 'c1', amountCents: 42000 }),
    tx({ categoryId: 'c2', amountCents: 25000 }),
    tx({ categoryId: 'c1', amountCents: 99999, date: '2025-02-10' }), // outro mês
    tx({ categoryId: 'c1', amountCents: 10000, goalId: 'g1' }), // aporte não é gasto
  ]
  const st = budgetStatus(budgets, cats, txs, '2025-03')
  const c1 = st.find((s) => s.category.id === 'c1')!
  const c2 = st.find((s) => s.category.id === 'c2')!
  assert.equal(c1.spentCents, 42000, 'ignora outro mês e ignora aporte em meta')
  assert.equal(c1.state, 'near', '84% do limite = perto')
  assert.equal(c2.state, 'over')
  assert.equal(st[0].category.id, 'c2', 'estourado vem primeiro')
}

// ---------- metas ----------
{
  const goals: Goal[] = [
    {
      id: 'g1',
      name: 'Viagem',
      targetCents: 500000,
      deadline: '2025-08-31',
      plannedMonthlyCents: 50000,
      done: 0,
    },
  ]
  const txs = [
    tx({ goalId: 'g1', amountCents: 100000 }),
    tx({ goalId: 'g1', amountCents: 25000, date: '2025-02-01' }),
    tx({ amountCents: 999999 }),
  ]
  const [p] = goalProgress(goals, txs, '2025-03')
  assert.equal(p.savedCents, 125000, 'aporte de qualquer mês conta')
  assert.equal(p.ratio, 0.25)
  assert.equal(p.neededMonthlyCents, 62500, '375000 restantes em 6 meses (mar..ago)')

  const surplus = suggestedSurplus(
    [tx({ type: 'income', amountCents: 300000 }), tx({ categoryId: 'c1', amountCents: 20000 })],
    [{ categoryId: 'c1', limitCents: 50000 }],
    '2025-03',
  )
  // 300000 renda - 20000 gasto - 30000 ainda reservado no orçamento
  assert.equal(surplus, 250000)
}

// ---------- previsão ----------
{
  const aluguel = {
    id: 'b1',
    name: 'Aluguel',
    type: 'expense' as const,
    amountCents: 180000,
    dueDay: 10,
    categoryId: 'c1',
    accountId: 'a2',
    notifyDaysBefore: 3,
    active: 1 as const,
  }
  const salario = {
    id: 'b2',
    name: 'Salário',
    type: 'income' as const,
    amountCents: 400000,
    dueDay: 5,
    categoryId: 'c9',
    accountId: 'a2',
    notifyDaysBefore: 1,
    active: 1 as const,
  }
  const cards = [{ id: 'card1', accountId: 'a3', name: 'Nubank', closingDay: 20, dueDay: 27 }]
  const invoiceTotals = new Map([
    ['card1:2025-03', 80000],
    ['card1:2025-04', 80000],
  ])
  const base = {
    accounts,
    txs: [] as Transaction[],
    payments: [],
    bills: [aluguel, salario],
    goals: [] as Goal[],
    cards,
    budgets: [] as Budget[],
    invoiceTotals,
    months: ['2025-03', '2025-04', '2025-05'],
  }

  const f = forecast({ ...base, from: '2025-03-01' })
  assert.equal(f[0].incomeCents, 400000)
  assert.equal(f[0].billsCents, 180000)
  assert.equal(f[0].invoiceCents, 80000)
  assert.equal(f[0].endCents, 250000 + 400000 - 180000 - 80000, 'saldo inicial 250000 + variação')
  assert.equal(f[2].endCents, f[1].endCents + f[2].deltaCents, 'acumula mês a mês')
  assert.equal(f[1].invoiceCents, 80000)
  assert.equal(f[2].invoiceCents, 0, 'mês sem fatura conhecida')

  // no dia 15 de março: salário (dia 5) e aluguel (dia 10) já passaram
  const meio = forecast({ ...base, from: '2025-03-15' })
  assert.equal(meio[0].incomeCents, 0)
  assert.equal(meio[0].billsCents, 0)
  assert.equal(meio[0].invoiceCents, 80000, 'fatura vence dia 27, ainda por vir')
  assert.equal(meio[1].billsCents, 180000, 'mês seguinte conta inteiro')

  // depois do vencimento, a fatura sai da projeção do mês corrente
  assert.equal(forecast({ ...base, from: '2025-03-28' })[0].invoiceCents, 0)

  // fatura marcada como paga nunca entra
  const pago = forecast({
    ...base,
    from: '2025-03-01',
    payments: [
      {
        key: 'card1:2025-03',
        cardId: 'card1',
        invoiceMonth: '2025-03',
        paidAt: '2025-03-27',
        amountCents: 80000,
        accountId: 'a2',
      },
    ],
  })
  assert.equal(pago[0].invoiceCents, 0)

  // conta já quitada neste mês não é cobrada de novo
  const quitado = forecast({
    ...base,
    from: '2025-03-01',
    bills: [{ ...aluguel, lastPaidMonth: '2025-03' }, salario],
  })
  assert.equal(quitado[0].billsCents, 0)
  assert.equal(quitado[1].billsCents, 180000)

  // limite de gasto desconta da projeção: sem isto a previsão só enxerga
  // conta fixa e promete uma sobra que nao existe
  // c5 nao tem conta fixa: o limite entra inteiro
  const comLimite = forecast({
    ...base,
    from: '2025-03-01',
    budgets: [{ categoryId: 'c5', limitCents: 100000 }],
  })
  assert.equal(comLimite[1].budgetCents, 100000, 'mes futuro reserva o limite inteiro')
  assert.equal(comLimite[1].endCents, f[1].endCents - 200000, 'dois meses futuros descontados')

  // no mes corrente, so o que ainda nao foi gasto continua reservado
  const meioGasto = forecast({
    ...base,
    from: '2025-03-01',
    txs: [tx({ categoryId: 'c5', amountCents: 70000, date: '2025-03-05' })],
    budgets: [{ categoryId: 'c5', limitCents: 100000 }],
  })
  assert.equal(meioGasto[0].budgetCents, 30000, 'gastou 70000 de 100000, restam 30000 reservados')

  // estourou o limite: nao reserva negativo
  const estourado = forecast({
    ...base,
    from: '2025-03-01',
    txs: [tx({ categoryId: 'c5', amountCents: 150000, date: '2025-03-05' })],
    budgets: [{ categoryId: 'c5', limitCents: 100000 }],
  })
  assert.equal(estourado[0].budgetCents, 0)

  // conta fixa e limite na MESMA categoria nao somam duas vezes
  const semDuplicar = forecast({
    ...base,
    from: '2025-03-01',
    bills: [aluguel, salario], // aluguel: 180000 na categoria c1
    budgets: [{ categoryId: 'c1', limitCents: 100000 }],
  })
  assert.equal(
    semDuplicar[1].budgetCents,
    0,
    'a conta fixa de 180000 ja cobre o limite de 100000 da mesma categoria',
  )

  // aporte planejado em meta desconta da projeção
  const comMeta = forecast({
    ...base,
    from: '2025-03-01',
    goals: [{ id: 'g1', name: 'Viagem', targetCents: 500000, plannedMonthlyCents: 50000, done: 0 }],
  })
  assert.equal(comMeta[0].goalsCents, 50000)
  assert.equal(comMeta[0].endCents, f[0].endCents - 50000)
}

// ---------- consultas batem com o schema do Dexie? ----------
// Este check existe porque um `orderBy('name')` num campo NAO indexado passou
// pelo TypeScript, pelo build e pelo lint, e so explodiu em runtime com
// SchemaError -- derrubando a tela inteira para tela preta. Nenhum teste de
// logica pura pega isso: e um contrato entre o codigo e o schema.
{
  const fs = await import('node:fs')
  const path = await import('node:path')
  const raiz = path.join(import.meta.dirname, '..')

  // le os indices declarados em db.ts: 'id, kind, archived' -> Set
  const schema = fs.readFileSync(path.join(raiz, 'db.ts'), 'utf8')
  const bloco = schema.match(/\.stores\(\{([\s\S]*?)\}\)/)
  assert.ok(bloco, 'nao achei o .stores() em db.ts')
  const indices = new Map<string, Set<string>>()
  for (const [, tabela, campos] of bloco![1].matchAll(/(\w+)\s*:\s*'([^']*)'/g)) {
    indices.set(
      tabela,
      new Set(
        campos
          .split(',')
          .map((c) => c.trim().replace(/^[&*]|^\[|\]$/g, ''))
          .filter(Boolean),
      ),
    )
  }
  assert.ok(indices.size >= 9, `schema com poucas tabelas: ${indices.size}`)

  const arquivos: string[] = []
  const varrer = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name)
      if (e.isDirectory()) varrer(f)
      else if (/\.tsx?$/.test(e.name) && !e.name.includes('selfcheck')) arquivos.push(f)
    }
  }
  varrer(raiz)

  const problemas: string[] = []
  for (const arquivo of arquivos) {
    const src = fs.readFileSync(arquivo, 'utf8')
    for (const m of src.matchAll(/db\.(\w+)\s*\.\s*(orderBy|where)\(\s*'([^']+)'/g)) {
      const [, tabela, metodo, campo] = m
      const campos = indices.get(tabela)
      if (!campos) {
        problemas.push(`${path.basename(arquivo)}: tabela "${tabela}" nao existe no schema`)
      } else if (!campos.has(campo)) {
        problemas.push(
          `${path.basename(arquivo)}: ${metodo}('${campo}') em "${tabela}", que indexa apenas [${[...campos].join(', ')}]`,
        )
      }
    }
  }
  assert.deepEqual(
    problemas,
    [],
    `consulta em campo nao indexado (Dexie lanca SchemaError em runtime): ${problemas.join(' | ')}`,
  )
}

console.log('✓ todos os checks passaram')
