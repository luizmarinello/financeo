import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { thisMonth } from '../dates'
import { formatMoney } from '../money'
import { budgetStatus } from '../finance/budget'
import { Card, Empty, MoneyField, MonthNav, Progress, Sheet, Topbar } from '../components/ui'

export default function Budget() {
  const [month, setMonth] = useState(thisMonth())
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState(0)

  const data = useLiveQuery(async () => {
    const [budgets, categories, txs] = await Promise.all([
      db.budgets.toArray(),
      db.categories.where('archived').equals(0).filter((c) => c.kind === 'expense').sortBy('name'),
      db.transactions.toArray(),
    ])
    return { budgets, categories, txs }
  }, [])

  if (!data) return null

  const status = budgetStatus(data.budgets, data.categories, data.txs, month)
  const withBudget = new Set(status.map((s) => s.category.id))
  const semOrcamento = data.categories.filter((c) => !withBudget.has(c.id))

  const totalLimit = status.reduce((s, b) => s + b.limitCents, 0)
  const totalSpent = status.reduce((s, b) => s + b.spentCents, 0)

  const editingCategory = data.categories.find((c) => c.id === editing)

  async function saveLimit(cents: number) {
    if (!editing) return
    if (cents > 0) await db.budgets.put({ categoryId: editing, limitCents: cents })
    else await db.budgets.delete(editing)
    setEditing(null)
  }

  return (
    <>
      <Topbar title="Orçamento" />
      <MonthNav month={month} onChange={setMonth} />

      {status.length > 0 && (
        <Card>
          <div className="row" style={{ marginBottom: 6 }}>
            <span className="grow">Total do mês</span>
            <span className="num">
              {formatMoney(totalSpent)} / {formatMoney(totalLimit)}
            </span>
          </div>
          <Progress
            ratio={totalLimit ? totalSpent / totalLimit : 0}
            variant={totalSpent > totalLimit ? 'over' : undefined}
          />
          <p className="muted" style={{ marginBottom: 0 }}>
            O limite renova igual todo mês. Sobra não acumula, estouro não desconta do mês seguinte.
          </p>
        </Card>
      )}

      {status.length === 0 && <Empty>Defina um limite para começar a acompanhar.</Empty>}

      {status.map((s) => (
        <button
          key={s.category.id}
          className="card"
          onClick={() => {
            setEditing(s.category.id)
            setDraft(s.limitCents)
          }}
          style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}
        >
          <div className="row" style={{ marginBottom: 6 }}>
            <span className="grow ellipsis">{s.category.name}</span>
            <span className={`num ${s.state === 'over' ? 'expense' : s.state === 'near' ? 'warn' : 'muted'}`}>
              {formatMoney(s.spentCents)} / {formatMoney(s.limitCents)}
            </span>
          </div>
          <Progress ratio={s.ratio} variant={s.state} />
          <p className="muted" style={{ margin: '6px 0 0' }}>
            {s.state === 'over'
              ? `${formatMoney(s.spentCents - s.limitCents)} acima do limite`
              : `${formatMoney(s.limitCents - s.spentCents)} disponíveis`}
          </p>
        </button>
      ))}

      {semOrcamento.length > 0 && (
        <Card title="Sem limite definido">
          <div className="chips">
            {semOrcamento.map((c) => (
              <button
                key={c.id}
                className="chip"
                onClick={() => {
                  setEditing(c.id)
                  setDraft(0)
                }}
              >
                + {c.name}
              </button>
            ))}
          </div>
        </Card>
      )}

      {editing && (
        <Sheet onClose={() => setEditing(null)}>
          <h2 style={{ marginTop: 0 }}>Limite: {editingCategory?.name}</h2>
          <MoneyField cents={draft} onChange={setDraft} autoFocus />
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => saveLimit(draft)}>
            Salvar
          </button>
          {draft > 0 && (
            <button
              className="btn ghost danger"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => saveLimit(0)}
            >
              Remover limite
            </button>
          )}
        </Sheet>
      )}
    </>
  )
}
