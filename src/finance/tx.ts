import { db, uid, type Kind, type Transaction } from '../db'
import { addMonths, invoiceFor, monthOf } from '../dates'
import { splitInstallments } from '../money'
import { installmentDates } from './installments'

export interface NewEntry {
  type: Kind
  amountCents: number
  categoryId: string
  accountId: string
  date: string
  description?: string
  /** se a conta for cartão de crédito */
  cardId?: string
  /** 1 = à vista */
  installments?: number
  goalId?: string
}

/**
 * Cria o lançamento. Compra parcelada vira N transações materializadas agora,
 * uma por fatura — assim fatura, histórico e previsão são a mesma query simples.
 */
export async function addEntry(e: NewEntry): Promise<string[]> {
  const n = Math.max(1, Math.floor(e.installments ?? 1))
  const card = e.cardId ? await db.cards.get(e.cardId) : undefined

  if (!card || n === 1) {
    const first = card ? invoiceFor(e.date, card) : undefined
    const t: Transaction = {
      id: uid(),
      type: e.type,
      amountCents: e.amountCents,
      categoryId: e.categoryId,
      accountId: e.accountId,
      date: e.date,
      description: e.description || undefined,
      cardId: e.cardId,
      invoiceMonth: first?.month,
      goalId: e.goalId,
    }
    await db.transactions.add(t)
    return [t.id]
  }

  const purchaseId = uid()
  const parts = splitInstallments(e.amountCents, n)
  const firstInvoice = invoiceFor(e.date, card)
  const datas = installmentDates(e.date, n)
  const rows: Transaction[] = parts.map((amountCents, i) => ({
    id: uid(),
    type: e.type,
    amountCents,
    categoryId: e.categoryId,
    accountId: e.accountId,
    date: datas[i],
    description: e.description || undefined,
    cardId: e.cardId,
    invoiceMonth: addMonths(firstInvoice.month, i),
    purchaseId,
    installmentN: i + 1,
    installmentOf: n,
  }))
  await db.transactions.bulkAdd(rows)
  return rows.map((r) => r.id)
}

/** Apaga o lançamento — e todas as parcelas irmãs, se for compra parcelada. */
export async function removeEntry(id: string) {
  const t = await db.transactions.get(id)
  if (!t) return
  if (t.purchaseId) await db.transactions.where('purchaseId').equals(t.purchaseId).delete()
  else await db.transactions.delete(id)
}

/** Lançamentos de um mês, mais recentes primeiro. */
export async function entriesOfMonth(month: string) {
  return db.transactions
    .where('date')
    .between(`${month}-00`, `${month}-99`)
    .reverse()
    .sortBy('date')
}

export const isSameMonth = (t: Transaction, month: string) => monthOf(t.date) === month
