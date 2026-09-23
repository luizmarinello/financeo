import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { byName, db, uid, type Category, type Kind } from '../db'
import { Card, Empty, Segmented, Sheet, Topbar } from '../components/ui'

export default function Categories() {
  const [kind, setKind] = useState<Kind>('expense')
  const [editing, setEditing] = useState<Category | 'new' | null>(null)
  const [name, setName] = useState('')

  const all = useLiveQuery(() => db.categories.toArray().then((r) => r.sort(byName)), [], [])
  const mine = all.filter((c) => c.kind === kind)
  const active = mine.filter((c) => !c.archived)
  const archived = mine.filter((c) => c.archived)

  function open(c: Category | 'new') {
    setEditing(c)
    setName(c === 'new' ? '' : c.name)
  }

  async function save() {
    const trimmed = name.trim()
    if (!trimmed) return
    if (editing === 'new') await db.categories.add({ id: uid(), name: trimmed, kind, archived: 0 })
    else if (editing) await db.categories.update(editing.id, { name: trimmed })
    setEditing(null)
  }

  /**
   * Arquivar em vez de apagar: some dos seletores, mas os lançamentos antigos
   * continuam mostrando o nome certo.
   */
  const toggleArchive = (c: Category) => db.categories.update(c.id, { archived: c.archived ? 0 : 1 })

  return (
    <>
      <Topbar
        title="Categorias"
        right={
          <button className="btn sm" onClick={() => open('new')}>
            + Nova
          </button>
        }
      />

      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: 'expense', label: 'Despesas', className: 'is-expense' },
          { value: 'income', label: 'Rendas', className: 'is-income' },
        ]}
      />

      <div style={{ height: 12 }} />

      {active.length === 0 && <Empty>Nenhuma categoria ativa.</Empty>}
      {active.length > 0 && (
        <Card>
          {active.map((c) => (
            <div className="row" key={c.id}>
              <button
                className="grow ellipsis"
                onClick={() => open(c)}
                style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer' }}
              >
                {c.name}
              </button>
              <button className="btn sm ghost" onClick={() => toggleArchive(c)}>
                Arquivar
              </button>
            </div>
          ))}
        </Card>
      )}

      {archived.length > 0 && (
        <Card title="Arquivadas">
          {archived.map((c) => (
            <div className="row" key={c.id}>
              <span className="grow ellipsis muted">{c.name}</span>
              <button className="btn sm ghost" onClick={() => toggleArchive(c)}>
                Reativar
              </button>
            </div>
          ))}
          <p className="muted" style={{ marginBottom: 0 }}>
            Arquivada some dos seletores, mas os lançamentos antigos continuam com o nome certo.
          </p>
        </Card>
      )}

      {editing && (
        <Sheet onClose={() => setEditing(null)}>
          <h2 style={{ marginTop: 0 }}>{editing === 'new' ? 'Nova categoria' : 'Renomear'}</h2>
          <input value={name} autoFocus onChange={(e) => setName(e.target.value)} />
          <button className="btn primary" style={{ marginTop: 12 }} onClick={save}>
            Salvar
          </button>
        </Sheet>
      )}
    </>
  )
}
