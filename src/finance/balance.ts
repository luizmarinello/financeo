import { db, type Account, type InvoicePayment, type Transaction } from '../db'
import { monthOf, today } from '../dates'

export interface AccountBalance {
  account: Account
  /** dinheiro disponível (contas cash/bank) */
  cents: number
}

/**
 * Saldo de verdade numa data, por padrão hoje.
 *
 * `ate` existe porque lançamento com data futura NÃO é dinheiro que já saiu:
 * marcar o aluguel para o dia 5 do mês que vem não deixa você mais pobre hoje.
 * Sem esse corte o saldo mentia e a previsão contava o mesmo gasto duas vezes,
 * uma no saldo de partida e outra ao somar o mês.
 *
 * Compra no cartão também NÃO tira dinheiro na hora: ela vira fatura. O que
 * tira é o pagamento da fatura. Por isso o saldo ignora transações de contas
 * 'credit' e desconta os pagamentos de fatura registrados.
 */
export function balances(
  accounts: Account[],
  txs: Transaction[],
  payments: InvoicePayment[],
  ate: string = today(),
): AccountBalance[] {
  const byId = new Map(accounts.map((a) => [a.id, a.openingCents]))
  const kind = new Map(accounts.map((a) => [a.id, a.kind]))

  for (const t of txs) {
    if (t.date > ate) continue // ainda não aconteceu
    if (kind.get(t.accountId) === 'credit') continue
    const cur = byId.get(t.accountId)
    if (cur === undefined) continue
    byId.set(t.accountId, cur + (t.type === 'income' ? t.amountCents : -t.amountCents))
  }
  for (const p of payments) {
    if (p.paidAt > ate) continue
    const cur = byId.get(p.accountId)
    if (cur !== undefined) byId.set(p.accountId, cur - p.amountCents)
  }

  return accounts
    .filter((a) => a.kind !== 'credit')
    .map((account) => ({ account, cents: byId.get(account.id) ?? 0 }))
}

export const totalLiquid = (bs: AccountBalance[]) => bs.reduce((s, b) => s + b.cents, 0)

export interface MonthSummary {
  incomeCents: number
  expenseCents: number
  /** o que sobrou: renda − gastos do mês (inclui gasto no cartão) */
  netCents: number
}

export function monthSummary(txs: Transaction[], month: string): MonthSummary {
  let incomeCents = 0
  let expenseCents = 0
  for (const t of txs) {
    if (monthOf(t.date) !== month) continue
    if (t.goalId) continue // aporte em meta não é gasto, é dinheiro guardado
    if (t.type === 'income') incomeCents += t.amountCents
    else expenseCents += t.amountCents
  }
  return { incomeCents, expenseCents, netCents: incomeCents - expenseCents }
}

/** Tudo que o app precisa carregar para montar a home. */
export async function loadBalanceData() {
  const [accounts, txs, payments] = await Promise.all([
    db.accounts.where('archived').equals(0).toArray(),
    db.transactions.toArray(),
    db.invoicePayments.toArray(),
  ])
  return { accounts, txs, payments }
}
