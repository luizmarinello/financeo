import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { byName, db } from '../db'
import { dateLabel, thisMonth } from '../dates'
import { formatMoney } from '../money'
import { entriesOfMonth, removeEntry } from '../finance/tx'
import { syncScheduleSoon } from '../notify'
import { Card, Empty, Money, MonthNav, Sheet, Topbar } from '../components/ui'

export default function History() {
  const [month, setMonth] = useState(thisMonth())
  const [q, setQ] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const txs = useLiveQuery(() => entriesOfMonth(month), [month], [])
  const categories = useLiveQuery(() => db.categories.toArray().then((r) => r.sort(byName)), [], [])
  const accounts = useLiveQuery(() => db.accounts.toArray().then((r) => r.sort(byName)), [], [])

  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? '—'
  const accName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '—'

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return txs.filter((t) => {
      if (categoryId && t.categoryId !== categoryId) return false
      if (accountId && t.accountId !== accountId) return false
      if (!needle) return true
      return (
        (t.description ?? '').toLowerCase().includes(needle) ||
        catName(t.categoryId).toLowerCase().includes(needle)
      )
    })
  }, [txs, q, categoryId, accountId, categories])

  const totals = filtered.reduce(
    (acc, t) => {
      if (t.type === 'income') acc.income += t.amountCents
      else acc.expense += t.amountCents
      return acc
    },
    { income: 0, expense: 0 },
  )

  // agrupa por dia para a lista ficar legível
  const byDay = useMemo(() => {
    const map = new Map<string, typeof filtered>()
    for (const t of filtered) {
      const list = map.get(t.date) ?? []
      list.push(t)
      map.set(t.date, list)
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [filtered])

  const current = filtered.find((t) => t.id === selected)

  return (
    <>
      <Topbar title="Histórico" />
      <MonthNav month={month} onChange={setMonth} />

      <div className="card" style={{ marginTop: 12 }}>
        <input
          type="search"
          placeholder="Buscar por descrição ou categoria"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="field-row" style={{ marginTop: 10 }}>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Todas as categorias</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Todas as formas</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <span className="grow muted">{filtered.length} lançamentos</span>
          <span className="income num">{formatMoney(totals.income)}</span>
          <span className="expense num">−{formatMoney(totals.expense)}</span>
        </div>
      </div>

      {byDay.length === 0 && <Empty>Nenhum lançamento neste período.</Empty>}

      {byDay.map(([date, list]) => (
        <Card key={date} title={dateLabel(date)}>
          {list.map((t) => (
            <button
              key={t.id}
              className="row"
              onClick={() => setSelected(t.id)}
              style={{
                width: '100%',
                background: 'none',
                border: 0,
                padding: '4px 0',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <div className="grow" style={{ overflow: 'hidden' }}>
                <div className="ellipsis">{t.description || catName(t.categoryId)}</div>
                <div className="muted ellipsis">
                  {t.description ? `${catName(t.categoryId)} · ` : ''}
                  {accName(t.accountId)}
                  {t.installmentOf ? ` · ${t.installmentN}/${t.installmentOf}` : ''}
                </div>
              </div>
              <Money cents={t.type === 'income' ? t.amountCents : -t.amountCents} signed />
            </button>
          ))}
        </Card>
      ))}

      {current && (
        <Sheet onClose={() => setSelected(null)}>
          <h2 style={{ marginTop: 0 }}>{current.description || catName(current.categoryId)}</h2>
          <p className="big" style={{ margin: '0 0 12px' }}>
            {formatMoney(current.amountCents)}
          </p>
          <p className="muted" style={{ marginTop: 0 }}>
            {dateLabel(current.date)} · {catName(current.categoryId)} · {accName(current.accountId)}
            {current.installmentOf
              ? ` · parcela ${current.installmentN} de ${current.installmentOf}`
              : ''}
          </p>
          {current.installmentOf && (
            <p className="muted">Apagar remove as {current.installmentOf} parcelas da compra.</p>
          )}
          <button
            className="btn danger"
            style={{ width: '100%' }}
            onClick={async () => {
              await removeEntry(current.id)
              syncScheduleSoon()
              setSelected(null)
            }}
          >
            Apagar
          </button>
        </Sheet>
      )}
    </>
  )
}
