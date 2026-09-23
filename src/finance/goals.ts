import { db, type Budget, type Goal, type Transaction } from '../db'
import { monthOf } from '../dates'
import { monthSummary } from './balance'

export interface GoalProgress {
  goal: Goal
  savedCents: number
  ratio: number
  /** quanto por mês para bater a meta até o prazo */
  neededMonthlyCents: number | null
}

export function goalProgress(goals: Goal[], txs: Transaction[], month: string): GoalProgress[] {
  const saved = new Map<string, number>()
  for (const t of txs) {
    if (!t.goalId) continue
    const delta = t.type === 'expense' ? t.amountCents : -t.amountCents // despesa = aporte
    saved.set(t.goalId, (saved.get(t.goalId) ?? 0) + delta)
  }
  return goals.map((goal) => {
    const savedCents = saved.get(goal.id) ?? 0
    const remaining = Math.max(0, goal.targetCents - savedCents)
    const monthsLeft = goal.deadline ? monthsBetween(month, monthOf(goal.deadline)) : null
    return {
      goal,
      savedCents,
      ratio: goal.targetCents > 0 ? savedCents / goal.targetCents : 0,
      neededMonthlyCents:
        monthsLeft !== null && monthsLeft > 0 ? Math.ceil(remaining / monthsLeft) : null,
    }
  })
}

function monthsBetween(a: string, b: string) {
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  return by * 12 + bm - (ay * 12 + am) + 1
}

/**
 * Quanto sobrou no mês e poderia virar aporte: renda − gastos − o que ainda
 * está reservado nos orçamentos. Sugestão só; registrar o aporte é manual.
 */
export function suggestedSurplus(txs: Transaction[], budgets: Budget[], month: string): number {
  const { incomeCents, expenseCents } = monthSummary(txs, month)
  const spentByCat = new Map<string, number>()
  for (const t of txs) {
    if (t.type !== 'expense' || t.goalId || monthOf(t.date) !== month) continue
    spentByCat.set(t.categoryId, (spentByCat.get(t.categoryId) ?? 0) + t.amountCents)
  }
  const stillReserved = budgets.reduce(
    (s, b) => s + Math.max(0, b.limitCents - (spentByCat.get(b.categoryId) ?? 0)),
    0,
  )
  return Math.max(0, incomeCents - expenseCents - stillReserved)
}

export async function loadGoalData() {
  const [goals, txs, budgets] = await Promise.all([
    db.goals.toArray(),
    db.transactions.toArray(),
    db.budgets.toArray(),
  ])
  return { goals, txs, budgets }
}
