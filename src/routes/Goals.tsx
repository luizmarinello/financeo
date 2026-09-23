import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { db, uid, type Goal } from '../db'
import { thisMonth } from '../dates'
import { formatMoney } from '../money'
import { goalProgress, suggestedSurplus } from '../finance/goals'
import { Card, Empty, MoneyField, Progress, Sheet, Topbar } from '../components/ui'

const BLANK = { name: '', targetCents: 0, deadline: '', plannedMonthlyCents: 0 }

export default function Goals() {
  const nav = useNavigate()
  const month = thisMonth()
  const [editing, setEditing] = useState<Goal | 'new' | null>(null)
  const [form, setForm] = useState(BLANK)

  const data = useLiveQuery(async () => {
    const [goals, txs, budgets] = await Promise.all([
      db.goals.toArray(),
      db.transactions.toArray(),
      db.budgets.toArray(),
    ])
    return { goals, txs, budgets }
  }, [])

  if (!data) return null

  const progress = goalProgress(data.goals, data.txs, month)
  const surplus = suggestedSurplus(data.txs, data.budgets, month)
  const active = progress.filter((p) => !p.goal.done)
  const done = progress.filter((p) => p.goal.done)

  function open(goal: Goal | 'new') {
    setEditing(goal)
    setForm(
      goal === 'new'
        ? BLANK
        : {
            name: goal.name,
            targetCents: goal.targetCents,
            deadline: goal.deadline ?? '',
            plannedMonthlyCents: goal.plannedMonthlyCents,
          },
    )
  }

  async function save() {
    if (!form.name.trim() || form.targetCents <= 0) return
    const base = {
      name: form.name.trim(),
      targetCents: form.targetCents,
      deadline: form.deadline || undefined,
      plannedMonthlyCents: form.plannedMonthlyCents,
    }
    if (editing === 'new') await db.goals.add({ id: uid(), done: 0, ...base })
    else if (editing) await db.goals.update(editing.id, base)
    setEditing(null)
  }

  async function remove(goal: Goal) {
    // os aportes viram lançamentos soltos; o dinheiro guardado não some
    await db.transactions.where('goalId').equals(goal.id).modify({ goalId: undefined })
    await db.goals.delete(goal.id)
    setEditing(null)
  }

  return (
    <>
      <Topbar
        title="Metas"
        right={
          <button className="btn sm" onClick={() => open('new')}>
            + Nova
          </button>
        }
      />

      {surplus > 0 && active.length > 0 && (
        <div className="banner">
          Sobrou <strong>{formatMoney(surplus)}</strong> este mês depois dos gastos e do que ainda
          está reservado no orçamento. Dá para mandar para uma meta — o aporte é você quem registra.
        </div>
      )}

      {active.length === 0 && <Empty>Nenhuma meta ativa. Crie uma para começar a guardar.</Empty>}

      {active.map((p) => (
        <Card key={p.goal.id}>
          <div className="row" style={{ marginBottom: 6 }}>
            <button
              className="grow ellipsis"
              onClick={() => open(p.goal)}
              style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', font: 'inherit', cursor: 'pointer' }}
            >
              {p.goal.name}
            </button>
            <span className="num muted">
              {formatMoney(p.savedCents)} / {formatMoney(p.goal.targetCents)}
            </span>
          </div>
          <Progress ratio={p.ratio} variant="goal" />
          <div className="row" style={{ marginTop: 8 }}>
            <span className="grow muted">
              {Math.round(p.ratio * 100)}%
              {p.neededMonthlyCents
                ? ` · ${formatMoney(p.neededMonthlyCents)}/mês para bater o prazo`
                : ''}
              {p.goal.plannedMonthlyCents
                ? ` · planejado ${formatMoney(p.goal.plannedMonthlyCents)}/mês`
                : ''}
            </span>
          </div>
          <div className="field-row" style={{ marginTop: 10 }}>
            <button className="btn sm" onClick={() => nav(`/lancar?meta=${p.goal.id}`)}>
              Registrar aporte
            </button>
            <button
              className="btn sm ghost"
              onClick={() => db.goals.update(p.goal.id, { done: 1 })}
            >
              Concluir
            </button>
          </div>
        </Card>
      ))}

      {done.length > 0 && (
        <Card title="Concluídas">
          {done.map((p) => (
            <div className="row" key={p.goal.id}>
              <span className="grow ellipsis">{p.goal.name}</span>
              <span className="num income">{formatMoney(p.savedCents)}</span>
              <button className="btn sm ghost" onClick={() => db.goals.update(p.goal.id, { done: 0 })}>
                Reabrir
              </button>
            </div>
          ))}
        </Card>
      )}

      {editing && (
        <Sheet onClose={() => setEditing(null)}>
          <h2 style={{ marginTop: 0 }}>{editing === 'new' ? 'Nova meta' : 'Editar meta'}</h2>

          <label>Nome</label>
          <input
            value={form.name}
            autoFocus
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Viagem, reserva de emergência…"
          />

          <label>Valor alvo</label>
          <MoneyField
            cents={form.targetCents}
            className=""
            onChange={(c) => setForm({ ...form, targetCents: c })}
          />

          <label>Prazo (opcional)</label>
          <input
            type="date"
            value={form.deadline}
            onChange={(e) => setForm({ ...form, deadline: e.target.value })}
          />

          <label>Aporte planejado por mês (entra na previsão)</label>
          <MoneyField
            cents={form.plannedMonthlyCents}
            className=""
            onChange={(c) => setForm({ ...form, plannedMonthlyCents: c })}
          />

          <button className="btn primary" style={{ marginTop: 14 }} onClick={save}>
            Salvar
          </button>
          {editing !== 'new' && (
            <button
              className="btn ghost danger"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => remove(editing)}
            >
              Apagar meta
            </button>
          )}
        </Sheet>
      )}
    </>
  )
}
