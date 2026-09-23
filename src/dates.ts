import type { ISODate } from './db'

/** 'YYYY-MM' */
export type Month = string

/** Hoje no fuso local, sem UTC no meio do caminho. */
export function today(): ISODate {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const pad = (n: number) => String(n).padStart(2, '0')

export const monthOf = (date: ISODate): Month => date.slice(0, 7)
export const dayOf = (date: ISODate) => Number(date.slice(8, 10))
export const thisMonth = () => monthOf(today())

export function daysInMonth(month: Month): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/** Junta mês + dia, encaixando dia 31 em meses curtos (31/02 -> 28 ou 29). */
export function dateIn(month: Month, day: number): ISODate {
  return `${month}-${pad(Math.min(day, daysInMonth(month)))}`
}

export function addMonths(month: Month, n: number): Month {
  const [y, m] = month.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`
}

/** Meses [from, from+n) */
export const monthRange = (from: Month, n: number): Month[] =>
  Array.from({ length: n }, (_, i) => addMonths(from, i))

export function addDays(date: ISODate, n: number): ISODate {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(y, m - 1, d + n)
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`
}

export const daysBetween = (a: ISODate, b: ISODate) =>
  Math.round((Date.parse(`${b}T00:00`) - Date.parse(`${a}T00:00`)) / 86_400_000)

const MONTH_NAMES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export function monthLabel(month: Month, long = false): string {
  const [y, m] = month.split('-').map(Number)
  const name = MONTH_NAMES[m - 1]
  return long ? `${name[0].toUpperCase()}${name.slice(1)} de ${y}` : `${name}/${String(y).slice(2)}`
}

export function dateLabel(date: ISODate): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`
}

/**
 * Em que fatura cai uma compra feita em `date`.
 *
 * Regra: se a compra é até o dia do fechamento, entra na fatura que fecha
 * neste mês; senão, na do mês seguinte. O mês da fatura é o do VENCIMENTO —
 * que é o mesmo do fechamento quando `dueDay > closingDay`, e o seguinte
 * quando o vencimento já virou o mês (ex.: fecha dia 28, vence dia 5).
 */
export function invoiceFor(
  date: ISODate,
  card: { closingDay: number; dueDay: number },
): { month: Month; dueDate: ISODate } {
  const closingMonth = addMonths(monthOf(date), dayOf(date) <= card.closingDay ? 0 : 1)
  const month = addMonths(closingMonth, card.dueDay > card.closingDay ? 0 : 1)
  return { month, dueDate: dateIn(month, card.dueDay) }
}

/** Data de vencimento de uma fatura já identificada pelo mês. */
export const invoiceDueDate = (month: Month, card: { dueDay: number }) => dateIn(month, card.dueDay)

/** A fatura está fechada quando a data de fechamento dela já passou. */
export function invoiceClosingDate(month: Month, card: { closingDay: number; dueDay: number }): ISODate {
  const closingMonth = addMonths(month, card.dueDay > card.closingDay ? 0 : -1)
  return dateIn(closingMonth, card.closingDay)
}
