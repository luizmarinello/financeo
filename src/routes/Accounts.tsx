import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, type Account, type AccountKind } from '../db'
import { formatMoney } from '../money'
import { balances } from '../finance/balance'
import { Card, MoneyField, Sheet, Topbar } from '../components/ui'

// Rótulos do TIPO da conta. Não podem repetir o nome das contas padrão, senão
// o Vale-alimentação aparece como "Conta / PIX" e parece erro.
const KIND_LABEL: Record<AccountKind, string> = {
  cash: 'Dinheiro',
  bank: 'Conta',
  credit: 'Cartão de crédito',
}

export default function Accounts() {
  const [editing, setEditing] = useState<Account | 'new' | null>(null)
  const [form, setForm] = useState({ name: '', kind: 'bank' as AccountKind, openingCents: 0 })

  const data = useLiveQuery(async () => {
    const [accounts, txs, payments] = await Promise.all([
      db.accounts.toArray(),
      db.transactions.toArray(),
      db.invoicePayments.toArray(),
    ])
    return { accounts, txs, payments }
  }, [])

  if (!data) return null

  const active = data.accounts.filter((a) => !a.archived)
  const bs = balances(active, data.txs, data.payments)
  const cents = (id: string) => bs.find((b) => b.account.id === id)?.cents

  function open(a: Account | 'new') {
    setEditing(a)
    setForm(a === 'new' ? { name: '', kind: 'bank', openingCents: 0 } : { name: a.name, kind: a.kind, openingCents: a.openingCents })
  }

  async function save() {
    const name = form.name.trim()
    if (!name) return
    if (editing === 'new')
      await db.accounts.add({ id: uid(), name, kind: form.kind, openingCents: form.openingCents, archived: 0 })
    else if (editing) await db.accounts.update(editing.id, { name, openingCents: form.openingCents })
    setEditing(null)
  }

  return (
    <>
      <Topbar
        title="Formas de pagamento"
        right={
          <button className="btn sm" onClick={() => open('new')}>
            + Nova
          </button>
        }
      />

      <Card>
        {active.map((a) => (
          <button
            className="row"
            key={a.id}
            onClick={() => open(a)}
            style={{ width: '100%', background: 'none', border: 0, padding: '4px 0', textAlign: 'left', cursor: 'pointer' }}
          >
            <div className="grow" style={{ overflow: 'hidden' }}>
              <div className="ellipsis">{a.name}</div>
              <div className="muted">{KIND_LABEL[a.kind]}</div>
            </div>
            {a.kind === 'credit' ? (
              <span className="muted">via fatura</span>
            ) : (
              <span className="num">{formatMoney(cents(a.id) ?? 0)}</span>
            )}
          </button>
        ))}
      </Card>

      <p className="muted">
        Cartão de crédito se cadastra em Cartões — a forma de pagamento é criada junto, com
        fechamento e vencimento.
      </p>

      {editing && (
        <Sheet onClose={() => setEditing(null)}>
          <h2 style={{ marginTop: 0 }}>{editing === 'new' ? 'Nova forma' : form.name}</h2>

          <label>Nome</label>
          <input
            value={form.name}
            autoFocus
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Carteira, Nubank, Caixa…"
          />

          {editing === 'new' && (
            <>
              <label>Tipo</label>
              <select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as AccountKind })}
              >
                <option value="bank">Conta (banco, PIX, vale)</option>
                <option value="cash">Dinheiro em espécie</option>
              </select>
            </>
          )}

          <label>Saldo inicial</label>
          <MoneyField
            cents={form.openingCents}
            className=""
            onChange={(c) => setForm({ ...form, openingCents: c })}
          />
          <p className="muted">Quanto já tinha aqui quando começou a usar o app.</p>

          <button className="btn primary" style={{ marginTop: 8 }} onClick={save}>
            Salvar
          </button>

          {editing !== 'new' && editing.kind !== 'credit' && (
            <button
              className="btn ghost"
              style={{ width: '100%', marginTop: 8 }}
              onClick={async () => {
                await db.accounts.update(editing.id, { archived: 1 })
                setEditing(null)
              }}
            >
              Arquivar
            </button>
          )}
        </Sheet>
      )}
    </>
  )
}
