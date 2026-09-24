import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { byName, db, uid, type Kind } from '../db'
import { dateIn, dateLabel, dayOf, thisMonth, today } from '../dates'
import { formatMoney, splitInstallments } from '../money'
import { addEntry, removeEntry, updateEntry } from '../finance/tx'
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
  const editId = params.get('id') ?? undefined
  // mês que estava aberto na tela de onde vim: lançar dali deve cair nele,
  // não em hoje. Mantém o dia de hoje quando ele existe naquele mês.
  const mesAlvo = params.get('mes') || thisMonth()

  const original = useLiveQuery(() => (editId ? db.transactions.get(editId) : undefined), [editId])
  const editando = Boolean(editId)
  const ehParcela = Boolean(original?.purchaseId)
  const [prefilled, setPrefilled] = useState(false)

  const [type, setType] = useState<Kind>('expense')
  const [amountCents, setAmount] = useState(0)
  const [categoryId, setCategory] = useState<string>()
  const [accountId, setAccount] = useState<string>()
  const [date, setDate] = useState(() => dateIn(mesAlvo, dayOf(today())))
  const [description, setDescription] = useState('')
  const [cardId, setCard] = useState<string>()
  const [installments, setInstallments] = useState(1)
  const [suggestion, setSuggestion] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const categories = useLiveQuery(
    () =>
      db.categories
        .where('archived')
        .equals(0)
        .filter((c) => c.kind === type)
        .toArray()
        .then((r) => r.sort(byName)),
    [type],
    [],
  )
  const accounts = useLiveQuery(
    () => db.accounts.where('archived').equals(0).toArray().then((r) => r.sort(byName)),
    [],
    [],
  )
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

  // modo edição: carrega o lançamento uma vez e para de sugerir nada
  useEffect(() => {
    if (!original || prefilled) return
    setType(original.type)
    setAmount(original.amountCents)
    setCategory(original.categoryId)
    setAccount(original.accountId)
    setDate(original.date)
    setDescription(original.description ?? '')
    setCard(original.cardId)
    setPrefilled(true)
  }, [original, prefilled])

  // pré-seleção pelo histórico recente
  useEffect(() => {
    if (editando) return
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
    if (editando && !prefilled) return
    if (!isCredit) {
      setCard(undefined)
      setInstallments(1)
    } else if (!cardId && cardsOfAccount.length) {
      setCard(cardsOfAccount[0].id)
    }
  }, [isCredit, cardId, cardsOfAccount])

  // sugestão de valor: último lançamento daquela categoria
  useEffect(() => {
    if (editando || !categoryId || amountCents > 0) {
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
      const entrada = {
        type,
        amountCents,
        categoryId: categoryId!,
        accountId: accountId!,
        date,
        description,
        cardId: isCredit ? cardId : undefined,
        installments: isCredit ? installments : 1,
        goalId,
      }
      if (editId) await updateEntry(editId, entrada)
      else await addEntry(entrada)
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
        title={editando ? 'Editar lançamento' : goal ? `Aporte: ${goal.name}` : 'Lançar'}
        right={
          <button className="btn sm ghost" onClick={goBack}>
            Cancelar
          </button>
        }
      />

      {!goal && !editando && shortcuts.length > 0 && (
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
            <div style={{ display: editando ? 'none' : undefined }}>
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

        {editando && ehParcela && (
          <p className="muted">
            Parcela {original?.installmentN} de {original?.installmentOf}. Editar aqui muda só esta
            parcela; as outras continuam como estão. Para mudar o valor total ou o número de
            parcelas, apague a compra e lance de novo.
          </p>
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

      {!goal && !editando && canSave && (
        <button className="btn ghost" style={{ width: '100%', marginTop: 8 }} onClick={saveAsShortcut}>
          Salvar como atalho
        </button>
      )}

      {editando && original && (
        <>
          <button
            className="btn ghost danger"
            style={{ width: '100%', marginTop: 8 }}
            onClick={async () => {
              const aviso = ehParcela
                ? `Apagar as ${original.installmentOf} parcelas desta compra?`
                : 'Apagar este lançamento?'
              if (!confirm(aviso)) return
              await removeEntry(original.id)
              syncScheduleSoon()
              goBack()
            }}
          >
            {ehParcela ? `Apagar as ${original.installmentOf} parcelas` : 'Apagar lançamento'}
          </button>
          <p className="muted" style={{ textAlign: 'center' }}>
            Lançado em {dateLabel(original.date)}
          </p>
        </>
      )}
    </>
  )
}
