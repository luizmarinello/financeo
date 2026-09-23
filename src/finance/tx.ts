import { db, uid, type ISODate, type Kind, type Transaction } from '../db'
import { addMonths, dateIn, dayOf, invoiceFor, monthOf } from '../dates'
import { splitInstallments } from '../money'

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
 * Quando cada parcela pesa no seu mês: a parcela N cai N meses depois da
 * compra, mantendo o dia.
 *
 * Não confundir com o mês da FATURA, que pode estar deslocado: comprar dia 22
 * num cartão que fechou dia 20 gera parcelas em set/out/nov, mas faturas em
 * out/nov/dez. Usar o mês da fatura como data faz a segunda parcela pular um
 * mês e deixa um mês inteiro zerado no resumo de gastos.
 */
export function installmentDates(purchase: ISODate, n: number): ISODate[] {
  const mes = monthOf(purchase)
  const dia = dayOf(purchase)
  return Array.from({ length: n }, (_, i) => dateIn(addMonths(mes, i), dia))
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
