import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { db, uid, type Kind } from '../db'
import { addMonths, dateIn, dateLabel, monthLabel, thisMonth, today } from '../dates'
import { formatMoney } from '../money'
import { balances, totalLiquid } from '../finance/balance'
import { invoiceTotalsByKey } from '../finance/invoice'
import { compromissos, loadPlan, savePlan, type PlanItem } from '../finance/plan'
import { Card, Money, MoneyField, MonthNav, Segmented, useMonthParam } from '../components/ui'

/**
 * Planejamento: a mesma conta da home, mas somando rendas e despesas que só
 * existem na cabeça da pessoa. Nada aqui vira lançamento, entra no saldo ou
 * dispara lembrete — é exatamente o ponto: dá para responder "sobra quanto?"
 * antes de pagar.
 */
export default function Plan() {
  const [month, setMonth] = useMonthParam()
  const [type, setType] = useState<Kind>('expense')
  const [label, setLabel] = useState('')
  const [amountCents, setAmount] = useState(0)

  const data = useLiveQuery(async () => {
    // a janela vai de hoje ao fim do mês aberto: o plano de outubro visto em
    // novembro continua comprometendo o dinheiro de hoje
    const meses: string[] = []
    for (let m = thisMonth(); m <= month; m = addMonths(m, 1)) meses.push(m)
    const [accounts, txs, payments, bills, cards, items, planos, invoiceTotals] = await Promise.all([
      db.accounts.where('archived').equals(0).toArray(),
      db.transactions.toArray(),
      db.invoicePayments.toArray(),
      db.bills.where('active').equals(1).toArray(),
      db.cards.toArray(),
      loadPlan(month),
      Promise.all(meses.map(loadPlan)),
      invoiceTotalsByKey(meses),
    ])
    return { accounts, txs, payments, bills, cards, items, plano: planos.flat(), invoiceTotals }
  }, [month])

  if (!data) return null

  const hoje = today()
  const bs = balances(data.accounts, data.txs, data.payments)
  const disponivel = totalLiquid(bs)
  const c = compromissos({ ...data, hoje, ate: dateIn(month, 31) })
  const livre = disponivel + c.aReceberCents - c.comprometidoCents
  const linhas = [
    { label: 'Contas fixas', cents: c.contasCents },
    { label: 'Já lançado para depois de hoje', cents: c.lancadoCents },
    { label: 'Faturas de cartão', cents: c.faturasCents },
    { label: 'Despesas planejadas', cents: c.planoCents },
  ].filter((l) => l.cents > 0)

  const add = async () => {
    if (!amountCents) return
    const item: PlanItem = { id: uid(), label: label.trim(), type, amountCents }
    await savePlan(month, [...data.items, item])
    setLabel('')
    setAmount(0)
  }

  const remove = (id: string) => savePlan(month, data.items.filter((i) => i.id !== id))

  return (
    <>
      <div style={{ padding: 'max(env(safe-area-inset-top), 0.75rem) 0 0.75rem' }}>
        <MonthNav month={month} onChange={setMonth} />
      </div>

      <Card>
        <p className="muted" style={{ margin: 0 }}>
          Disponível hoje ({dateLabel(hoje)})
        </p>
        <p className={`big ${disponivel < 0 ? 'expense' : ''}`} style={{ margin: '2px 0 12px' }}>
          {formatMoney(disponivel)}
        </p>
        {bs.map((b) => (
          <div className="row" key={b.account.id}>
            <span className="grow ellipsis">{b.account.name}</span>
            <Money cents={b.cents} />
          </div>
        ))}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <section className="card">
          <h2>Comprometido</h2>
          <p className="big expense" style={{ margin: 0, fontSize: 22 }}>
            {formatMoney(c.comprometidoCents)}
          </p>
        </section>
        <section className="card">
          <h2>A receber</h2>
          <p className="big income" style={{ margin: 0, fontSize: 22 }}>
            {formatMoney(c.aReceberCents)}
          </p>
        </section>
      </div>

      <Card title={`Até o fim de ${monthLabel(month, true)}`}>
        {linhas.map((l) => (
          <div className="row" key={l.label}>
            <span className="grow">{l.label}</span>
            <span className="num expense">−{formatMoney(l.cents)}</span>
          </div>
        ))}
        {linhas.length === 0 && <p className="muted" style={{ marginTop: 0 }}>Nada comprometido.</p>}
        <div className="row">
          <span className="grow">
            <strong>Livre no fim do mês</strong>
          </span>
          <strong className={`num ${livre < 0 ? 'expense' : 'income'}`}>{formatMoney(livre)}</strong>
        </div>
      </Card>

      <Card title="Simular">
        <Segmented
          value={type}
          onChange={setType}
          options={[
            { value: 'expense', label: 'Despesa', className: 'is-expense' },
            { value: 'income', label: 'Renda', className: 'is-income' },
          ]}
        />
        <label>Do que se trata</label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={type === 'income' ? 'Ex.: freela' : 'Ex.: pneu novo'}
        />
        <label>Valor</label>
        <MoneyField cents={amountCents} onChange={setAmount} className="" />
        <button
          className="btn primary"
          style={{ width: '100%', marginTop: 12 }}
          disabled={!amountCents}
          onClick={add}
        >
          Adicionar ao plano
        </button>
      </Card>

      <Card title={`Plano de ${monthLabel(month, true)}`}>
        {data.items.length === 0 && (
          <p className="muted" style={{ marginTop: 0 }}>
            Nada planejado ainda. Some aqui o que você pensa em gastar ou receber — não vira
            lançamento e não mexe no seu saldo.
          </p>
        )}
        {data.items.map((i) => (
          <div className="row" key={i.id}>
            <span className="grow ellipsis">
              {i.label || (i.type === 'income' ? 'Renda' : 'Despesa')}
            </span>
            <Money cents={i.type === 'income' ? i.amountCents : -i.amountCents} signed />
            <button className="btn sm ghost" onClick={() => remove(i.id)} aria-label="Remover">
              ×
            </button>
          </div>
        ))}
      </Card>

      <p className="muted">
        Livre = disponível hoje + o que vai entrar − o que já está comprometido até o fim do mês.
        O plano não vira lançamento: quando um item acontecer de verdade, lance no + e apague daqui.
        Para a projeção com orçamento e metas, veja a <Link to="/previsao">previsão</Link>.
      </p>
    </>
  )
}
