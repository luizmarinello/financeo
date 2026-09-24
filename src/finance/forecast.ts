import {
  db,
  type Account,
  type Bill,
  type Budget,
  type Card,
  type Goal,
  type InvoicePayment,
  type Transaction,
} from '../db'
import { dateIn, monthOf, monthRange, thisMonth, today, type Month } from '../dates'
import { balances, totalLiquid } from './balance'
import { invoiceTotalsByKey } from './invoice'

export interface ForecastMonth {
  month: Month
  incomeCents: number
  billsCents: number
  invoiceCents: number
  /** limites de gasto ainda não consumidos (mercado, gasolina, etc.) */
  budgetCents: number
  goalsCents: number
  /** variação esperada do mês */
  deltaCents: number
  /** saldo líquido projetado no fim do mês */
  endCents: number
}

export interface ForecastInput {
  accounts: Account[]
  txs: Transaction[]
  payments: InvoicePayment[]
  bills: Bill[]
  goals: Goal[]
  cards: Card[]
  budgets: Budget[]
  /** total de cada fatura, chaveado 'cardId:YYYY-MM' */
  invoiceTotals: Map<string, number>
  months: Month[]
  /** data de corte: o que é anterior a ela já está no saldo, não é projeção */
  from: string
}

/**
 * Projeção mês a mês a partir do saldo líquido de hoje.
 *
 * No mês corrente só entra o que ainda está por vir — conta que já venceu e
 * transação já lançada estão no saldo, não na projeção. Compra no cartão entra
 * uma vez só, pelo total da fatura, nunca pela transação individual.
 */
export function forecast(input: ForecastInput): ForecastMonth[] {
  const { accounts, txs, payments, bills, goals, cards, budgets, invoiceTotals, months, from } = input
  const cardById = new Map(cards.map((c) => [c.id, c]))
  const current = monthOf(from)
  const paid = new Set(payments.map((p) => p.key))
  const creditAccounts = new Set(accounts.filter((a) => a.kind === 'credit').map((a) => a.id))

  let running = totalLiquid(balances(accounts, txs, payments))

  // gasto já realizado no mês corrente, por categoria: o orçamento só reserva
  // o que ainda não foi gasto
  const gastoDoMes = new Map<string, number>()
  for (const t of txs) {
    if (t.type !== 'expense' || t.goalId || monthOf(t.date) !== current) continue
    gastoDoMes.set(t.categoryId, (gastoDoMes.get(t.categoryId) ?? 0) + t.amountCents)
  }

  return months.map((month) => {
    const future = month > current
    let incomeCents = 0
    let billsCents = 0
    // quanto de conta fixa cai em cada categoria neste mês, para o orçamento
    // não somar por cima do que já foi contado
    const billsPorCategoria = new Map<string, number>()

    for (const b of bills) {
      if (!b.active) continue
      const due = dateIn(month, b.dueDay)
      if (!future && (due < from || b.lastPaidMonth === month)) continue
      if (b.type === 'income') incomeCents += b.amountCents
      else {
        billsCents += b.amountCents
        billsPorCategoria.set(b.categoryId, (billsPorCategoria.get(b.categoryId) ?? 0) + b.amountCents)
      }
    }

    // transações avulsas já lançadas com data futura (cartão sai pela fatura)
    for (const t of txs) {
      if (monthOf(t.date) !== month || t.date <= from) continue
      if (creditAccounts.has(t.accountId) || t.goalId) continue
      if (t.type === 'income') incomeCents += t.amountCents
      else billsCents += t.amountCents
    }

    let invoiceCents = 0
    for (const [key, cents] of invoiceTotals) {
      if (paid.has(key) || !key.endsWith(`:${month}`)) continue
      const card = cardById.get(key.slice(0, -month.length - 1))
      // fatura do mês corrente que já venceu: ou foi paga, ou o estrago já
      // está no saldo. De um jeito ou de outro, não é projeção.
      if (!future && card && dateIn(month, card.dueDay) < from) continue
      invoiceCents += cents
    }

    const goalsCents = goals.reduce((s, g) => (g.done ? s : s + g.plannedMonthlyCents), 0)

    // Gasto variável que o orçamento já reservou. Sem isto a previsão só
    // enxerga conta fixa e diz que sobra muito mais do que sobra: quem tem
    // R$ 1.000 de mercado por mês não pode ver esse dinheiro como livre.
    const budgetCents = budgets.reduce((s, b) => {
      // o que já entrou como conta fixa naquela categoria não conta de novo
      const jaContado = billsPorCategoria.get(b.categoryId) ?? 0
      const reservado = future
        ? b.limitCents
        : Math.max(0, b.limitCents - (gastoDoMes.get(b.categoryId) ?? 0))
      return s + Math.max(0, reservado - jaContado)
    }, 0)

    const deltaCents = incomeCents - billsCents - invoiceCents - budgetCents - goalsCents
    running += deltaCents
    return {
      month,
      incomeCents,
      billsCents,
      invoiceCents,
      budgetCents,
      goalsCents,
      deltaCents,
      endCents: running,
    }
  })
}

export async function loadForecast(monthCount = 3): Promise<ForecastMonth[]> {
  const from = today()
  const months = monthRange(thisMonth(), monthCount)
  const [accounts, txs, payments, bills, goals, cards, budgets] = await Promise.all([
    db.accounts.toArray(),
    db.transactions.toArray(),
    db.invoicePayments.toArray(),
    db.bills.where('active').equals(1).toArray(),
    db.goals.where('done').equals(0).toArray(),
    db.cards.toArray(),
    db.budgets.toArray(),
  ])
  const invoiceTotals = await invoiceTotalsByKey(months)
  return forecast({ accounts, txs, payments, bills, goals, cards, budgets, invoiceTotals, months, from })
}
