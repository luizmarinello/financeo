import { db, type Card, type Transaction } from '../db'
import { invoiceClosingDate, invoiceDueDate, today, type Month } from '../dates'

export type InvoiceStatus = 'open' | 'closed' | 'paid'

export interface Invoice {
  card: Card
  month: Month
  items: Transaction[]
  totalCents: number
  closingDate: string
  dueDate: string
  status: InvoiceStatus
  paidCents: number
}

export async function getInvoice(cardId: string, month: Month): Promise<Invoice | null> {
  const card = await db.cards.get(cardId)
  if (!card) return null
  const [items, payment] = await Promise.all([
    db.transactions.where('invoiceMonth').equals(month).filter((t) => t.cardId === cardId).toArray(),
    db.invoicePayments.get(`${cardId}:${month}`),
  ])
  items.sort((a, b) => a.date.localeCompare(b.date))

  const totalCents = items.reduce(
    (s, t) => s + (t.type === 'income' ? -t.amountCents : t.amountCents),
    0,
  )
  const closingDate = invoiceClosingDate(month, card)
  const status: InvoiceStatus = payment ? 'paid' : today() > closingDate ? 'closed' : 'open'

  return {
    card,
    month,
    items,
    totalCents,
    closingDate,
    dueDate: invoiceDueDate(month, card),
    status,
    paidCents: payment?.amountCents ?? 0,
  }
}

export async function payInvoice(cardId: string, month: Month, accountId: string, amountCents: number) {
  await db.invoicePayments.put({
    key: `${cardId}:${month}`,
    cardId,
    invoiceMonth: month,
    paidAt: today(),
    amountCents,
    accountId,
  })
}

export const unpayInvoice = (cardId: string, month: Month) =>
  db.invoicePayments.delete(`${cardId}:${month}`)

/**
 * Total de cada fatura por `cardId:YYYY-MM` — alimenta a previsão de saldo.
 * A chave é a mesma de `invoicePayments`, então dá para descartar as pagas.
 */
export async function invoiceTotalsByKey(months: Month[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const rows = await db.transactions.where('invoiceMonth').anyOf(months).toArray()
  for (const t of rows) {
    if (!t.invoiceMonth || !t.cardId) continue
    const key = `${t.cardId}:${t.invoiceMonth}`
    const prev = out.get(key) ?? 0
    out.set(key, prev + (t.type === 'income' ? -t.amountCents : t.amountCents))
  }
  return out
}
