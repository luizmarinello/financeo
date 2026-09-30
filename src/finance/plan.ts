import {
  db,
  type Account,
  type Bill,
  type Card,
  type InvoicePayment,
  type ISODate,
  type Kind,
  type Transaction,
} from '../db'
import { addMonths, dateIn, invoiceDueDate, monthOf, type Month } from '../dates'

/**
 * Item de planejamento: renda ou despesa que a pessoa ainda NÃO lançou e
 * talvez nunca lance. Serve para responder "se eu pagar isso, sobra quanto?"
 * antes de pagar.
 */
export interface PlanItem {
  id: string
  label: string
  type: Kind
  amountCents: number
}

/**
 * Mora em `settings` e não em tabela própria de propósito: é rascunho, não
 * tem índice, não entra em saldo, previsão, orçamento nem lembrete. Tabela
 * nova custaria migração de schema para guardar uma lista.
 */
export const planKey = (month: Month) => `plano:${month}`

export async function loadPlan(month: Month): Promise<PlanItem[]> {
  const row = await db.settings.get(planKey(month))
  return (row?.value as PlanItem[] | undefined) ?? []
}

export const savePlan = (month: Month, items: PlanItem[]) =>
  db.settings.put({ key: planKey(month), value: items })

export interface Compromissos {
  /** renda que ainda vai entrar: contas fixas de renda, lançamentos futuros e plano */
  aReceberCents: number
  contasCents: number
  /** despesas já lançadas com data futura (fora do cartão) */
  lancadoCents: number
  faturasCents: number
  planoCents: number
  comprometidoCents: number
}

/**
 * O que ainda vai sair e entrar entre hoje (exclusive) e `ate`. Tudo que é
 * até hoje já está no saldo disponível; contar aqui seria contar duas vezes.
 * Compra no cartão entra só pela fatura, igual à previsão.
 */
export function compromissos(input: {
  accounts: Account[]
  txs: Transaction[]
  payments: InvoicePayment[]
  bills: Bill[]
  cards: Card[]
  invoiceTotals: Map<string, number>
  /** itens de plano de todos os meses da janela */
  plano: PlanItem[]
  hoje: ISODate
  ate: ISODate
}): Compromissos {
  const { accounts, txs, payments, bills, cards, invoiceTotals, plano, hoje, ate } = input
  const credito = new Set(accounts.filter((a) => a.kind === 'credit').map((a) => a.id))
  const pagas = new Set(payments.map((p) => p.key))
  const dentro = (d: ISODate) => d > hoje && d <= ate

  let aReceberCents = 0
  let contasCents = 0
  let lancadoCents = 0
  let faturasCents = 0
  let planoCents = 0

  for (let m = monthOf(hoje); m <= monthOf(ate); m = addMonths(m, 1)) {
    for (const b of bills) {
      if (!b.active || b.lastPaidMonth === m || (b.untilMonth && m > b.untilMonth)) continue
      if (!dentro(dateIn(m, b.dueDay))) continue
      if (b.type === 'income') aReceberCents += b.amountCents
      else contasCents += b.amountCents
    }
    for (const c of cards) {
      const key = `${c.id}:${m}`
      if (pagas.has(key) || !dentro(invoiceDueDate(m, c))) continue
      faturasCents += Math.max(0, invoiceTotals.get(key) ?? 0)
    }
  }

  for (const t of txs) {
    if (!dentro(t.date) || credito.has(t.accountId) || t.goalId) continue
    if (t.type === 'income') aReceberCents += t.amountCents
    else lancadoCents += t.amountCents
  }

  for (const i of plano) {
    if (i.type === 'income') aReceberCents += i.amountCents
    else planoCents += i.amountCents
  }

  return {
    aReceberCents,
    contasCents,
    lancadoCents,
    faturasCents,
    planoCents,
    comprometidoCents: contasCents + lancadoCents + faturasCents + planoCents,
  }
}
