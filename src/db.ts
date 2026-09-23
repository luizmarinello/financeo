import Dexie, { type EntityTable } from 'dexie'

/** Valores sempre em centavos inteiros. Datas sempre 'YYYY-MM-DD'. */
export type ISODate = string

export type Kind = 'expense' | 'income'
export type AccountKind = 'cash' | 'bank' | 'credit'

export interface Transaction {
  id: string
  type: Kind
  amountCents: number
  categoryId: string
  accountId: string
  date: ISODate
  description?: string
  /** compra no cartão */
  cardId?: string
  /** 'YYYY-MM' da fatura em que cai, calculado no lançamento */
  invoiceMonth?: string
  /** agrupa as N parcelas de uma mesma compra */
  purchaseId?: string
  installmentN?: number
  installmentOf?: number
  /** aporte em meta de economia */
  goalId?: string
}

export interface Category {
  id: string
  name: string
  kind: Kind
  archived: 0 | 1 // Dexie não indexa boolean
}

export interface Account {
  id: string
  name: string
  kind: AccountKind
  /** saldo inicial de quando o app começou a ser usado */
  openingCents: number
  archived: 0 | 1
}

export interface Card {
  id: string
  /** conta do tipo 'credit' que representa este cartão */
  accountId: string
  name: string
  closingDay: number // dia do fechamento (1-31)
  dueDay: number     // dia do vencimento (1-31)
  limitCents?: number
}

/** Uma linha por categoria. Renova igual todo mês, não acumula. */
export interface Budget {
  categoryId: string
  limitCents: number
}

export interface Goal {
  id: string
  name: string
  targetCents: number
  deadline?: ISODate
  /** quanto o usuário planeja aportar por mês (entra na previsão) */
  plannedMonthlyCents: number
  done: 0 | 1
}

/** Recorrência mensal: conta a pagar ou renda esperada (ex.: salário). */
export interface Bill {
  id: string
  name: string
  type: Kind
  amountCents: number
  dueDay: number
  categoryId: string
  accountId: string
  notifyDaysBefore: number
  active: 0 | 1
  /** 'YYYY-MM' da última vez que foi quitada; evita contar duas vezes */
  lastPaidMonth?: string
}

/** Lançamento favorito, disparável em um toque. */
export interface Shortcut {
  id: string
  label: string
  type: Kind
  amountCents: number
  categoryId: string
  accountId: string
  uses: number
}

/** Pagamentos de fatura já registrados: chave 'cardId:YYYY-MM'. */
export interface InvoicePayment {
  key: string
  cardId: string
  invoiceMonth: string
  paidAt: ISODate
  amountCents: number
  /** conta de onde saiu o dinheiro */
  accountId: string
}

export interface Setting {
  key: string
  value: unknown
}

export const db = new Dexie('financas') as Dexie & {
  transactions: EntityTable<Transaction, 'id'>
  categories: EntityTable<Category, 'id'>
  accounts: EntityTable<Account, 'id'>
  cards: EntityTable<Card, 'id'>
  budgets: EntityTable<Budget, 'categoryId'>
  goals: EntityTable<Goal, 'id'>
  bills: EntityTable<Bill, 'id'>
  shortcuts: EntityTable<Shortcut, 'id'>
  invoicePayments: EntityTable<InvoicePayment, 'key'>
  settings: EntityTable<Setting, 'key'>
}

db.version(1).stores({
  transactions: 'id, date, categoryId, accountId, type, cardId, invoiceMonth, purchaseId, goalId',
  categories: 'id, kind, archived',
  accounts: 'id, kind, archived',
  cards: 'id, accountId',
  budgets: 'categoryId',
  goals: 'id, done',
  bills: 'id, active, dueDay',
  shortcuts: 'id, uses',
  invoicePayments: 'key, cardId',
  settings: 'key',
})

export const uid = () => crypto.randomUUID()

/**
 * Ordena por nome respeitando acento: sem `localeCompare`, "Água" vai parar
 * depois de "Transporte" porque 'Á' tem código maior que 'Z'.
 *
 * Use isto em vez de `orderBy('name')`: `name` NAO e um indice, e o Dexie
 * lanca SchemaError e derruba a tela inteira.
 */
export const byName = <T extends { name: string }>(a: T, b: T) =>
  a.name.localeCompare(b.name, 'pt-BR')

const SEED_CATEGORIES: Array<[string, Kind]> = [
  ['Alimentação', 'expense'],
  ['Mercado', 'expense'],
  ['Transporte', 'expense'],
  ['Moradia', 'expense'],
  ['Contas', 'expense'],
  ['Saúde', 'expense'],
  ['Lazer', 'expense'],
  ['Educação', 'expense'],
  ['Compras', 'expense'],
  ['Outros', 'expense'],
  ['Salário', 'income'],
  ['Freelance', 'income'],
  ['Rendimentos', 'income'],
  ['Outras rendas', 'income'],
]

/** Roda uma vez na primeira abertura. Idempotente. */
export async function seed() {
  if (await db.categories.count()) return
  await db.transaction('rw', db.categories, db.accounts, async () => {
    await db.categories.bulkAdd(
      SEED_CATEGORIES.map(([name, kind]) => ({ id: uid(), name, kind, archived: 0 as const })),
    )
    await db.accounts.bulkAdd([
      { id: uid(), name: 'Espécie', kind: 'cash', openingCents: 0, archived: 0 },
      { id: uid(), name: 'Conta / PIX', kind: 'bank', openingCents: 0, archived: 0 },
    ])
  })
}
