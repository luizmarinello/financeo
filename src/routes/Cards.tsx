import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useSearchParams } from 'react-router-dom'
import { db, uid, type Card as CardType } from '../db'
import { dateLabel, thisMonth } from '../dates'
import { formatMoney } from '../money'
import { getInvoice, payInvoice, unpayInvoice } from '../finance/invoice'
import { syncScheduleSoon } from '../notify'
import { Card, Empty, MonthNav, Sheet, Topbar } from '../components/ui'

const BLANK = { name: '', closingDay: 20, dueDay: 27 }

const STATUS_LABEL = { open: 'Aberta', closed: 'Fechada', paid: 'Paga' } as const

export default function Cards() {
  const [params, setParams] = useSearchParams()
  const [month, setMonth] = useState(thisMonth())
  const [editing, setEditing] = useState<CardType | 'new' | null>(null)
  const [form, setForm] = useState(BLANK)

  const cards = useLiveQuery(() => db.cards.toArray(), [], [])
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])

  const selectedId = params.get('cartao') ?? cards[0]?.id
  useEffect(() => {
    if (!params.get('cartao') && cards[0]) setParams({ cartao: cards[0].id }, { replace: true })
  }, [cards, params, setParams])

  const invoice = useLiveQuery(
    async () => (selectedId ? getInvoice(selectedId, month) : null),
    [selectedId, month],
  )

  const payAccounts = accounts.filter((a) => a.kind !== 'credit')
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? '—'

  function open(card: CardType | 'new') {
    setEditing(card)
    setForm(card === 'new' ? BLANK : { name: card.name, closingDay: card.closingDay, dueDay: card.dueDay })
  }

  async function save() {
    const name = form.name.trim()
    if (!name) return
    const closingDay = clampDay(form.closingDay)
    const dueDay = clampDay(form.dueDay)
    if (editing === 'new') {
      // o cartão também é uma forma de pagamento: cria a conta junto
      const accountId = uid()
      const cardId = uid()
      await db.accounts.add({ id: accountId, name, kind: 'credit', openingCents: 0, archived: 0 })
      await db.cards.add({ id: cardId, accountId, name, closingDay, dueDay })
      setParams({ cartao: cardId })
    } else if (editing) {
      await db.cards.update(editing.id, { name, closingDay, dueDay })
      await db.accounts.update(editing.accountId, { name })
      // mudou o ciclo: as faturas das compras antigas continuam onde estavam
    }
    setEditing(null)
    syncScheduleSoon()
  }

  async function remove(card: CardType) {
    const used = await db.transactions.where('cardId').equals(card.id).count()
    if (used > 0) {
      alert(
        `Este cartão tem ${used} lançamentos. Apague-os no histórico antes, ou o saldo vai ficar errado.`,
      )
      return
    }
    await db.cards.delete(card.id)
    await db.accounts.delete(card.accountId)
    setEditing(null)
    setParams({})
  }

  return (
    <>
      <Topbar
        title="Cartões"
        right={
          <button className="btn sm" onClick={() => open('new')}>
            + Novo
          </button>
        }
      />

      {cards.length === 0 && <Empty>Cadastre um cartão para acompanhar a fatura.</Empty>}

      {cards.length > 1 && (
        <div className="chips" style={{ marginBottom: 12 }}>
          {cards.map((c) => (
            <button
              key={c.id}
              className="chip"
              aria-pressed={c.id === selectedId}
              onClick={() => setParams({ cartao: c.id })}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {invoice && (
        <>
          <MonthNav month={month} onChange={setMonth} />

          <Card>
            <div className="row">
              <div className="grow">
                <p className="muted" style={{ margin: 0 }}>
                  Fatura de {invoice.card.name}
                </p>
                <p className="big" style={{ margin: '2px 0 0' }}>
                  {formatMoney(invoice.totalCents)}
                </p>
              </div>
              <span className={`pill ${invoice.status}`}>{STATUS_LABEL[invoice.status]}</span>
            </div>
            <p className="muted" style={{ marginBottom: 0 }}>
              Fecha {dateLabel(invoice.closingDate)} · vence {dateLabel(invoice.dueDate)}
            </p>

            {invoice.status === 'paid' ? (
              <button
                className="btn sm ghost"
                style={{ marginTop: 12 }}
                onClick={async () => {
                  await unpayInvoice(invoice.card.id, month)
                  syncScheduleSoon()
                }}
              >
                Desfazer pagamento ({formatMoney(invoice.paidCents)})
              </button>
            ) : (
              invoice.totalCents > 0 &&
              payAccounts.length > 0 && (
                <div className="field-row" style={{ marginTop: 12 }}>
                  <select id="conta-pgto" defaultValue={payAccounts[0].id}>
                    {payAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn"
                    onClick={async () => {
                      const sel = document.getElementById('conta-pgto') as HTMLSelectElement
                      await payInvoice(invoice.card.id, month, sel.value, invoice.totalCents)
                      syncScheduleSoon()
                    }}
                  >
                    Marcar paga
                  </button>
                </div>
              )
            )}
          </Card>

          <Card title={`${invoice.items.length} itens`}>
            {invoice.items.length === 0 && <p className="muted">Nada nesta fatura.</p>}
            {invoice.items.map((t) => (
              <div className="row" key={t.id}>
                <div className="grow" style={{ overflow: 'hidden' }}>
                  <div className="ellipsis">{t.description || catName(t.categoryId)}</div>
                  <div className="muted">
                    {dateLabel(t.date)} · {catName(t.categoryId)}
                    {t.installmentOf ? ` · parcela ${t.installmentN}/${t.installmentOf}` : ''}
                  </div>
                </div>
                <span className="num">{formatMoney(t.amountCents)}</span>
              </div>
            ))}
          </Card>

          <button className="btn" style={{ width: '100%' }} onClick={() => open(invoice.card)}>
            Editar {invoice.card.name}
          </button>
        </>
      )}

      {editing && (
        <Sheet onClose={() => setEditing(null)}>
          <h2 style={{ marginTop: 0 }}>{editing === 'new' ? 'Novo cartão' : 'Editar cartão'}</h2>

          <label>Nome</label>
          <input
            value={form.name}
            autoFocus
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Nubank, Inter…"
          />

          <div className="field-row">
            <div>
              <label>Dia do fechamento</label>
              <input
                type="number"
                min={1}
                max={31}
                value={form.closingDay}
                onChange={(e) => setForm({ ...form, closingDay: Number(e.target.value) })}
              />
            </div>
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
          </div>
          <p className="muted">
            Compra até o dia {clampDay(form.closingDay)} entra na fatura que vence dia{' '}
            {clampDay(form.dueDay)}
            {form.dueDay > form.closingDay ? ' do mesmo mês' : ' do mês seguinte'}.
          </p>

          <button className="btn primary" style={{ marginTop: 8 }} onClick={save}>
            Salvar
          </button>
          {editing !== 'new' && (
            <button
              className="btn ghost danger"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => remove(editing)}
            >
              Apagar cartão
            </button>
          )}
        </Sheet>
      )}
    </>
  )
}

const clampDay = (d: number) => Math.min(31, Math.max(1, Math.round(d) || 1))
