import { db, type Bill, type Card } from '../db'
import { addDays, dateIn, invoiceDueDate, monthRange, thisMonth, today } from '../dates'
import { formatMoney } from '../money'
import { invoiceTotalsByKey } from './invoice'

/**
 * Um lembrete agendado. É exatamente isto — e só isto — que sobe para o
 * servidor de push: quando disparar, título e texto. Nenhum histórico,
 * categoria, saldo ou fatura detalhada sai do aparelho.
 */
export interface Reminder {
  /** determinístico: mesma conta + mesmo mês = mesmo id, então re-sincronizar não duplica */
  id: string
  sendAt: string // ISODate
  title: string
  body: string
}

const HORIZON_MONTHS = 3

/** Monta a agenda dos próximos meses a partir dos dados locais. */
export async function buildSchedule(from = today()): Promise<Reminder[]> {
  const months = monthRange(thisMonth(), HORIZON_MONTHS)
  const [bills, cards] = await Promise.all([
    db.bills.where('active').equals(1).toArray(),
    db.cards.toArray(),
  ])
  const invoiceTotals = await invoiceTotalsByKey(months)
  const paid = new Set((await db.invoicePayments.toArray()).map((p) => p.key))

  const out: Reminder[] = []

  for (const month of months) {
    for (const b of bills) {
      if (b.type === 'income' || b.lastPaidMonth === month) continue
      out.push(billReminder(b, month))
    }
    for (const card of cards) {
      const key = `${card.id}:${month}`
      const cents = invoiceTotals.get(key)
      if (!cents || cents <= 0 || paid.has(key)) continue
      out.push(invoiceReminder(card, month, cents))
    }
  }

  return out.filter((r) => r.sendAt >= from).sort((a, b) => a.sendAt.localeCompare(b.sendAt))
}

function billReminder(b: Bill, month: string): Reminder {
  const due = dateIn(month, b.dueDay)
  const days = b.notifyDaysBefore
  return {
    id: `bill:${b.id}:${month}`,
    sendAt: addDays(due, -days),
    title: `${b.name} vence ${days === 0 ? 'hoje' : days === 1 ? 'amanhã' : `em ${days} dias`}`,
    body: `${formatMoney(b.amountCents)} · vencimento ${due.slice(8, 10)}/${due.slice(5, 7)}`,
  }
}

const INVOICE_DAYS_BEFORE = 3

function invoiceReminder(card: Card, month: string, cents: number): Reminder {
  const due = invoiceDueDate(month, card)
  return {
    id: `invoice:${card.id}:${month}`,
    sendAt: addDays(due, -INVOICE_DAYS_BEFORE),
    title: `Fatura ${card.name} vence em ${INVOICE_DAYS_BEFORE} dias`,
    body: `${formatMoney(cents)} · vencimento ${due.slice(8, 10)}/${due.slice(5, 7)}`,
  }
}
