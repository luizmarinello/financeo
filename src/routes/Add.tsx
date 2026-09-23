import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { db, uid, type Kind } from '../db'
import { today } from '../dates'
import { formatMoney, splitInstallments } from '../money'
import { addEntry } from '../finance/tx'
import { defaultsFor, lastAmountFor } from '../finance/suggest'
import { checkBudgetAlerts, syncScheduleSoon } from '../notify'
import { Chips, MoneyField, Segmented, Topbar } from '../components/ui'

/**
 * Tela de lançar. O caminho curto é: atalho → Salvar (2 toques). O caminho
 * longo pré-seleciona categoria e forma de pagamento pelo histórico recente,
 * então quase nunca precisa mexer nelas.
 */
export default function Add() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const goalId = params.get('meta') ?? undefined

  const [type, setType] = useState<Kind>('expense')
  const [amountCents, setAmount] = useState(0)
  const [categoryId, setCategory] = useState<string>()
  const [accountId, setAccount] = useState<string>()
  const [date, setDate] = useState(today())
  const [description, setDescription] = useState('')
  const [cardId, setCard] = useState<string>()
  const [installments, setInstallments] = useState(1)
  const [suggestion, setSuggestion] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const categories = useLiveQuery(
    () => db.categories.where('archived').equals(0).filter((c) => c.kind === type).sortBy('name'),
    [type],
    [],
  )
  const accounts = useLiveQuery(() => db.accounts.where('archived').equals(0).sortBy('name'), [], [])
  const cards = useLiveQuery(() => db.cards.toArray(), [], [])
  const shortcuts = useLiveQuery(
    () => db.shortcuts.orderBy('uses').reverse().limit(8).toArray(),
    [],
    [],
  )
  const goal = useLiveQuery(() => (goalId ? db.goals.get(goalId) : undefined), [goalId])

  // aberto direto por link ou notificação não tem para onde voltar
  const goBack = () =>
    (history.state as { idx?: number } | null)?.idx ? nav(-1) : nav('/', { replace: true })

  const account = accounts.find((a) => a.id === accountId)
  const isCredit = account?.kind === 'credit'
  const cardsOfAccount = useMemo(
    () => cards.filter((c) => c.accountId === accountId),
    [cards, accountId],
  )

  // pré-seleção pelo histórico recente
  useEffect(() => {
    let alive = true
    defaultsFor(type).then((d) => {
      if (!alive) return
      setCategory((cur) => cur ?? d.categoryId)
      setAccount((cur) => cur ?? d.accountId)
    })
    return () => {
      alive = false
    }
  }, [type])

  // trocou de tipo: a categoria antiga pode não existir mais nessa lista
  useEffect(() => {
    if (categoryId && categories.length && !categories.some((c) => c.id === categoryId)) {
      setCategory(categories[0]?.id)
    }
  }, [categories, categoryId])

  // conta que não é cartão não tem parcela
  useEffect(() => {
    if (!isCredit) {
      setCard(undefined)
      setInstallments(1)
    } else if (!cardId && cardsOfAccount.length) {
      setCard(cardsOfAccount[0].id)
    }
  }, [isCredit, cardId, cardsOfAccount])

  // sugestão de valor: último lançamento daquela categoria
  useEffect(() => {
    if (!categoryId || amountCents > 0) {
      setSuggestion(null)
      return
    }
    lastAmountFor(categoryId, type).then(setSuggestion)
  }, [categoryId, type, amountCents])

  function applyShortcut(id: string) {
    const s = shortcuts.find((x) => x.id === id)
    if (!s) return
    setType(s.type)
    setAmount(s.amountCents)
    setCategory(s.categoryId)
    setAccount(s.accountId)
    setDescription(s.label)
  }

  const canSave = amountCents > 0 && categoryId && accountId && !saving

  async function save() {
    if (!canSave) return
    setSaving(true)
    try {
      await addEntry({
        type,
        amountCents,
        categoryId: categoryId!,
        accountId: accountId!,
        date,
        description,
        cardId: isCredit ? cardId : undefined,
        installments: isCredit ? installments : 1,
        goalId,
      })
      // usa o atalho equivalente, se existir, para ele subir na lista
      const used = shortcuts.find(
        (s) => s.label === description && s.categoryId === categoryId && s.type === type,
      )
      if (used) await db.shortcuts.update(used.id, { uses: used.uses + 1 })

      await checkBudgetAlerts()
      syncScheduleSoon()
      goBack()
    } finally {
      setSaving(false)
    }
  }

  async function saveAsShortcut() {
    if (!categoryId || !accountId || !amountCents) return
    const label = description.trim() || categories.find((c) => c.id === categoryId)?.name || 'Atalho'
    await db.shortcuts.add({
      id: uid(),
      label,
      type,
      amountCents,
      categoryId,
      accountId,
      uses: 1,
    })
  }

  const parcelaPreview =
    isCredit && installments > 1 ? splitInstallments(amountCents, installments)[0] : null

  return (
    <>
      <Topbar
        title={goal ? `Aporte: ${goal.name}` : 'Lançar'}
        right={
          <button className="btn sm ghost" onClick={goBack}>
            Cancelar
          </button>
        }
      />

      {!goal && shortcuts.length > 0 && (
        <div className="card">
          <h2>Atalhos</h2>
          <div className="chips">
            {shortcuts.map((s) => (
              <button key={s.id} className="chip ellipsis" onClick={() => applyShortcut(s.id)}>
                {s.label} · {formatMoney(s.amountCents)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        {!goal && (
          <Segmented
            value={type}
            onChange={setType}
            options={[
              { value: 'expense', label: 'Despesa', className: 'is-expense' },
              { value: 'income', label: 'Renda', className: 'is-income' },
            ]}
          />
        )}

        <MoneyField cents={amountCents} onChange={setAmount} autoFocus />

        {suggestion !== null && suggestion > 0 && (
          <button className="btn sm ghost" onClick={() => setAmount(suggestion)}>
            Usar último valor: {formatMoney(suggestion)}
          </button>
        )}

        <label>Categoria</label>
        <Chips
          value={categoryId}
          onChange={setCategory}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
        />

        <label>Forma de pagamento</label>
        <Chips
          value={accountId}
          onChange={setAccount}
          options={accounts.map((a) => ({ value: a.id, label: a.name }))}
        />

        {isCredit && (
          <div className="field-row">
            <div>
              <label>Cartão</label>
              <select value={cardId ?? ''} onChange={(e) => setCard(e.target.value)}>
                {cardsOfAccount.length === 0 && <option value="">Cadastre um cartão</option>}
                {cardsOfAccount.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Parcelas</label>
              <select
                value={installments}
                onChange={(e) => setInstallments(Number(e.target.value))}
              >
                {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}x
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {parcelaPreview !== null && (
          <p className="muted">
            {installments}x de {formatMoney(parcelaPreview)} — começa na próxima fatura.
          </p>
        )}

        <div className="field-row">
          <div>
            <label>Data</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label>Descrição</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="opcional"
            />
          </div>
        </div>
      </div>

      <button className="btn primary" onClick={save} disabled={!canSave}>
        {saving ? 'Salvando…' : 'Salvar'}
      </button>

      {!goal && canSave && (
        <button className="btn ghost" style={{ width: '100%', marginTop: 8 }} onClick={saveAsShortcut}>
          Salvar como atalho
        </button>
      )}
    </>
  )
}
