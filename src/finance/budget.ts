import { db, type Budget, type Category, type Transaction } from '../db'
import { monthOf } from '../dates'

export interface BudgetStatus {
  category: Category
  limitCents: number
  spentCents: number
  /** 0..n, onde 1 = no limite */
  ratio: number
  state: 'ok' | 'near' | 'over'
}

/** Avisa a partir de 80% do limite. */
export const NEAR_LIMIT = 0.8

export function budgetStatus(
  budgets: Budget[],
  categories: Category[],
  txs: Transaction[],
  month: string,
): BudgetStatus[] {
  const spent = new Map<string, number>()
  for (const t of txs) {
    if (t.type !== 'expense' || t.goalId || monthOf(t.date) !== month) continue
    spent.set(t.categoryId, (spent.get(t.categoryId) ?? 0) + t.amountCents)
  }
  const catById = new Map(categories.map((c) => [c.id, c]))

  return budgets
    .flatMap((b) => {
      const category = catById.get(b.categoryId)
      if (!category || b.limitCents <= 0) return []
      const spentCents = spent.get(b.categoryId) ?? 0
      const ratio = spentCents / b.limitCents
      const state = ratio >= 1 ? 'over' : ratio >= NEAR_LIMIT ? 'near' : 'ok'
      return [{ category, limitCents: b.limitCents, spentCents, ratio, state } as BudgetStatus]
    })
    .sort((a, b) => b.ratio - a.ratio)
}

/** Total orçado no mês — usado na sugestão de sobra para metas. */
export const totalBudgeted = (budgets: Budget[]) => budgets.reduce((s, b) => s + b.limitCents, 0)

export async function loadBudgetData() {
  const [budgets, categories, txs] = await Promise.all([
    db.budgets.toArray(),
    db.categories.toArray(),
    db.transactions.toArray(),
  ])
  return { budgets, categories, txs }
}
