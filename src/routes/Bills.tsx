import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, type Bill, type Kind } from '../db'
import { dateIn, dateLabel, daysBetween, thisMonth, today } from '../dates'
import { formatMoney } from '../money'
import { addEntry } from '../finance/tx'
import { checkBudgetAlerts, syncScheduleSoon } from '../notify'
import { Card, Empty, MoneyField, Segmented, Sheet, Topbar } from '../components/ui'

const BLANK = {
  name: '',
  type: 'expense' as Kind,
  amountCents: 0,
  dueDay: 10,
  categoryId: '',
  accountId: '',
  notifyDaysBefore: 3,
}

export default function Bills() {
  const month = thisMonth()
  const [editing, setEditing] = useState<Bill | 'new' | null>(null)
  const [form, setForm] = useState(BLANK)

  const bills = useLiveQuery(() => db.bills.toArray(), [], [])
  const categories = useLiveQuery(() => db.categories.where('archived').equals(0).sortBy('name'), [], [])
  const accounts = useLiveQuery(() => db.accounts.where('archived').equals(0).sortBy('name'), [], [])

  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? '—'
  const formCategories = categories.filter((c) => c.kind === form.type)

  const sorted = [...bills].sort((a, b) => a.dueDay - b.dueDay)
  const expenses = sorted.filter((b) => b.type === 'expense')
  const incomes = sorted.filter((b) => b.type === 'income')

  function open(bill: Bill | 'new') {
    setEditing(bill)
    setForm(
      bill === 'new'
        ? { ...BLANK, categoryId: categories.find((c) => c.kind === 'expense')?.id ?? '', accountId: accounts[0]?.id ?? '' }
        : { ...bill },
    )
  }

  async function save() {
    const name = form.name.trim()
    if (!name || form.amountCents <= 0 || !form.categoryId || !form.accountId) return
    const base = {
      name,
      type: form.type,
      amountCents: form.amountCents,
      dueDay: Math.min(31, Math.max(1, form.dueDay || 1)),
      categoryId: form.categoryId,
      accountId: form.accountId,
      notifyDaysBefore: Math.min(30, Math.max(0, form.notifyDaysBefore)),
    }
    if (editing === 'new') await db.bills.add({ id: uid(), active: 1, ...base })
    else if (editing) await db.bills.update(editing.id, base)
    setEditing(null)
    syncScheduleSoon()
  }

  /** Quitar cria o lançamento de verdade e marca o mês para não contar duas vezes. */
  async function settle(bill: Bill) {
    await addEntry({
      type: bill.type,
      amountCents: bill.amountCents,
      categoryId: bill.categoryId,
      accountId: bill.accountId,
      date: today(),
      description: bill.name,
    })
    await db.bills.update(bill.id, { lastPaidMonth: month })
    await checkBudgetAlerts()
    syncScheduleSoon()
  }

  function renderBill(b: Bill) {
    const due = dateIn(month, b.dueDay)
    const left = daysBetween(today(), due)
    const settled = b.lastPaidMonth === month
    const late = !settled && left < 0
    return (
      <div className="row" key={b.id}>
        <div className="grow" style={{ overflow: 'hidden' }}>
          <button
            className="ellipsis"
            onClick={() => open(b)}
            style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}
          >
            {b.name}
            {!b.active && ' (pausada)'}
          </button>
          <div className={`muted ${late ? 'expense' : ''}`}>
            dia {b.dueDay} ·{' '}
            {settled
              ? 'quitada este mês'
              : late
                ? `${-left} dias em atraso`
                : left === 0
                  ? 'vence hoje'
                  : `em ${left} dias`}{' '}
            · avisa {b.notifyDaysBefore}d antes · {catName(b.categoryId)}
          </div>
        </div>
        <span className={`num ${b.type === 'income' ? 'income' : ''}`}>
          {formatMoney(b.amountCents)}
        </span>
        {!settled && b.active === 1 && (
          <button className="btn sm" onClick={() => settle(b)}>
            {b.type === 'income' ? 'Recebi' : 'Paguei'}
          </button>
        )}
      </div>
    )
  }

  return (
    <>
      <Topbar
        title="Contas fixas"
        right={
          <button className="btn sm" onClick={() => open('new')}>
            + Nova
          </button>
        }
      />

      {bills.length === 0 && (
        <Empty>
          Cadastre o que se repete todo mês — aluguel, internet, salário. Vira lembrete de vencimento
          e entra na previsão.
        </Empty>
      )}

      {expenses.length > 0 && <Card title="A pagar">{expenses.map(renderBill)}</Card>}
      {incomes.length > 0 && <Card title="A receber">{incomes.map(renderBill)}</Card>}

      {editing && (
        <Sheet onClose={() => setEditing(null)}>
          <h2 style={{ marginTop: 0 }}>{editing === 'new' ? 'Nova recorrência' : form.name}</h2>

          <Segmented
            value={form.type}
            onChange={(type) =>
              setForm({
                ...form,
                type,
                categoryId: categories.find((c) => c.kind === type)?.id ?? '',
              })
            }
            options={[
              { value: 'expense', label: 'A pagar', className: 'is-expense' },
              { value: 'income', label: 'A receber', className: 'is-income' },
            ]}
          />

          <label>Nome</label>
          <input
            value={form.name}
            autoFocus
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Aluguel, internet, salário…"
          />

          <label>Valor</label>
          <MoneyField
            cents={form.amountCents}
            className=""
            onChange={(c) => setForm({ ...form, amountCents: c })}
          />

          <div className="field-row">
            <div>
              <label>Dia do vencimento</label>
              <input
                type="number"
                min={1}
                max={31}
                value={form.dueDay}
                onChange={(e) => setForm({ ...form, dueDay: Number(e.target.value) })}
              />
            </div>
            <div>
              <label>Avisar quantos dias antes</label>
              <input
                type="number"
                min={0}
                max={30}
                value={form.notifyDaysBefore}
                onChange={(e) => setForm({ ...form, notifyDaysBefore: Number(e.target.value) })}
              />
            </div>
          </div>

          <label>Categoria</label>
          <select
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
          >
            {formCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <label>Forma de pagamento</label>
          <select
            value={form.accountId}
            onChange={(e) => setForm({ ...form, accountId: e.target.value })}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>

          <button className="btn primary" style={{ marginTop: 14 }} onClick={save}>
            Salvar
          </button>

          {editing !== 'new' && (
            <div className="field-row" style={{ marginTop: 8 }}>
              <button
                className="btn ghost"
                onClick={async () => {
                  await db.bills.update(editing.id, { active: editing.active ? 0 : 1 })
                  setEditing(null)
                  syncScheduleSoon()
                }}
              >
                {editing.active ? 'Pausar' : 'Reativar'}
              </button>
              <button
                className="btn ghost danger"
                onClick={async () => {
                  await db.bills.delete(editing.id)
                  setEditing(null)
                  syncScheduleSoon()
                }}
              >
                Apagar
              </button>
            </div>
          )}
          <p className="muted">
            Quitar cria o lançamento de verdade no histórico. Até lá, a conta só existe como
            previsão e lembrete. Próximo vencimento: {dateLabel(dateIn(month, form.dueDay))}.
          </p>
        </Sheet>
      )}
    </>
  )
}
