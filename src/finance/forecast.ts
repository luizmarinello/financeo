import { db, type Account, type Bill, type Card, type Goal, type InvoicePayment, type Transaction } from '../db'
import { dateIn, monthOf, monthRange, thisMonth, today, type Month } from '../dates'
import { balances, totalLiquid } from './balance'
import { invoiceTotalsByKey } from './invoice'

export interface ForecastMonth {
  month: Month
  incomeCents: number
  billsCents: number
  invoiceCents: number
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
  const { accounts, txs, payments, bills, goals, cards, invoiceTotals, months, from } = input
  const cardById = new Map(cards.map((c) => [c.id, c]))
  const current = monthOf(from)
  const paid = new Set(payments.map((p) => p.key))
  const creditAccounts = new Set(accounts.filter((a) => a.kind === 'credit').map((a) => a.id))

  let running = totalLiquid(balances(accounts, txs, payments))

  return months.map((month) => {
    const future = month > current
    let incomeCents = 0
    let billsCents = 0

    for (const b of bills) {
      if (!b.active) continue
      const due = dateIn(month, b.dueDay)
      if (!future && (due < from || b.lastPaidMonth === month)) continue
      if (b.type === 'income') incomeCents += b.amountCents
      else billsCents += b.amountCents
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

    const deltaCents = incomeCents - billsCents - invoiceCents - goalsCents
    running += deltaCents
    return { month, incomeCents, billsCents, invoiceCents, goalsCents, deltaCents, endCents: running }
  })
}

export async function loadForecast(monthCount = 3): Promise<ForecastMonth[]> {
  const from = today()
  const months = monthRange(thisMonth(), monthCount)
  const [accounts, txs, payments, bills, goals, cards] = await Promise.all([
    db.accounts.toArray(),
    db.transactions.toArray(),
    db.invoicePayments.toArray(),
    db.bills.where('active').equals(1).toArray(),
    db.goals.where('done').equals(0).toArray(),
    db.cards.toArray(),
  ])
  const invoiceTotals = await invoiceTotalsByKey(months)
  return forecast({ accounts, txs, payments, bills, goals, cards, invoiceTotals, months, from })
}
