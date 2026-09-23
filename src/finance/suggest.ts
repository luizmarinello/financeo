import { db, type Kind } from '../db'

/** Olha só os últimos lançamentos: hábito recente vale mais que histórico antigo. */
const WINDOW = 120

export interface Defaults {
  categoryId?: string
  accountId?: string
}

/** Categoria e forma de pagamento mais usadas ultimamente, por tipo. */
export async function defaultsFor(type: Kind): Promise<Defaults> {
  const recent = await db.transactions.orderBy('date').reverse().limit(WINDOW).toArray()
  const mine = recent.filter((t) => t.type === type && !t.goalId)
  return { categoryId: mostCommon(mine.map((t) => t.categoryId)), accountId: mostCommon(mine.map((t) => t.accountId)) }
}

/** Último valor lançado nessa categoria — vira sugestão de um toque. */
export async function lastAmountFor(categoryId: string, type: Kind): Promise<number | null> {
  const recent = await db.transactions.orderBy('date').reverse().limit(WINDOW).toArray()
  const hit = recent.find((t) => t.categoryId === categoryId && t.type === type && !t.goalId)
  return hit?.amountCents ?? null
}

function mostCommon(ids: string[]): string | undefined {
  const count = new Map<string, number>()
  for (const id of ids) count.set(id, (count.get(id) ?? 0) + 1)
  let best: string | undefined
  let bestN = 0
  for (const [id, n] of count) {
    if (n > bestN) {
      best = id
      bestN = n
    }
  }
  return best
}
