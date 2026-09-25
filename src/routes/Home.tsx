import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { db } from '../db'
import { dateLabel, monthLabel, monthOf, thisMonth, today } from '../dates'
import { formatMoney } from '../money'
import { balances, monthSummary, totalLiquid } from '../finance/balance'
import { budgetStatus } from '../finance/budget'
import { invoiceTotalsByKey } from '../finance/invoice'
import { invoiceDueDate } from '../dates'
import { syncScheduleSoon } from '../notify'
import { Card, Money, MonthNav, Progress, useMonthParam } from '../components/ui'

export default function Home() {
  const [month, setMonth] = useMonthParam()
  const mesCorrente = month === thisMonth()

  // a agenda de lembretes pode ter mudado por conta do tempo passar
  useEffect(syncScheduleSoon, [])

  const data = useLiveQuery(async () => {
    const [accounts, txs, payments, budgets, categories, cards] = await Promise.all([
      db.accounts.where('archived').equals(0).toArray(),
      db.transactions.toArray(),
      db.invoicePayments.toArray(),
      db.budgets.toArray(),
      db.categories.toArray(),
      db.cards.toArray(),
    ])
    const invoiceTotals = await invoiceTotalsByKey([month])
    return { accounts, txs, payments, budgets, categories, cards, invoiceTotals }
  }, [month])

  if (!data) return null

  const bs = balances(data.accounts, data.txs, data.payments)
  const liquid = totalLiquid(bs)
  const summary = monthSummary(data.txs, month)
  const alerts = budgetStatus(data.budgets, data.categories, data.txs, month).filter(
    (b) => b.state !== 'ok',
  )
  const paid = new Set(data.payments.map((p) => p.key))
  const openInvoices = data.cards
    .map((card) => ({
      card,
      cents: data.invoiceTotals.get(`${card.id}:${month}`) ?? 0,
      due: invoiceDueDate(month, card),
      paid: paid.has(`${card.id}:${month}`),
    }))
    .filter((i) => i.cents > 0 && !i.paid)

  // No mês corrente, parcela futura não é "último lançamento": ela ainda vai
  // acontecer. Em mês passado ou futuro, mostra o mês inteiro.
  const hoje = today()
  const recent = data.txs
    .filter((t) => monthOf(t.date) === month && (!mesCorrente || t.date <= hoje))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5)
  const catName = (id: string) => data.categories.find((c) => c.id === id)?.name ?? '—'

  // Vazio tem dois motivos bem diferentes: nunca lancei nada, ou lancei em
  // outro mes. Dizer "nada lancado ainda" no segundo caso e mentira, e foi
  // assim que o cartao pareceu quebrado depois que a Home ganhou seletor de mes.
  const ultimoLancamento = data.txs
    .filter((t) => t.date <= hoje)
    .reduce<string | null>((maior, t) => (!maior || t.date > maior ? t.date : maior), null)
  const mesDoUltimo = ultimoLancamento ? monthOf(ultimoLancamento) : null

  // Saldo zerado logo depois de configurar o app quase sempre quer dizer
  // "ainda não informei quanto tenho", não "estou sem dinheiro". Sem esta
  // dica a previsão inteira sai deslocada e não há nada na tela explicando.
  const faltaSaldoInicial =
    liquid === 0 &&
    !ultimoLancamento &&
    data.accounts.every((a) => a.openingCents === 0) &&
    data.accounts.length > 0

  return (
    <>
      <div style={{ padding: 'max(env(safe-area-inset-top), 0.75rem) 0 0.75rem' }}>
        <MonthNav month={month} onChange={setMonth} />
      </div>

      <Card>
        <p className="muted" style={{ margin: 0 }}>
          {/* navegando outro mês, o saldo continua sendo o de hoje: sem a data
              explícita isso vira leitura errada */}
          {mesCorrente ? 'Disponível hoje' : `Disponível hoje (${dateLabel(hoje)})`}
        </p>
        <p className={`big ${liquid < 0 ? 'expense' : ''}`} style={{ margin: '2px 0 12px' }}>
          {formatMoney(liquid)}
        </p>
        {bs.map((b) => (
          <div className="row" key={b.account.id}>
            <span className="grow ellipsis">{b.account.name}</span>
            <Money cents={b.cents} />
          </div>
        ))}

        {faltaSaldoInicial && (
          <>
            <p className="muted" style={{ marginBottom: '0.5rem' }}>
              Você ainda não disse quanto tem hoje. Sem isso a previsão parte do zero e todos os
              meses aparecem negativos.
            </p>
            <Link className="btn sm" to="/formas-de-pagamento">
              Informar meu saldo
            </Link>
          </>
        )}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <section className="card">
          <h2>Entrou</h2>
          <p className="big income" style={{ margin: 0, fontSize: 22 }}>
            {formatMoney(summary.incomeCents)}
          </p>
        </section>
        <section className="card">
          <h2>Saiu</h2>
          <p className="big expense" style={{ margin: 0, fontSize: 22 }}>
            {formatMoney(summary.expenseCents)}
          </p>
        </section>
      </div>

      {alerts.length > 0 && (
        <Card title="Atenção no orçamento">
          {alerts.map((a) => (
            <div key={a.category.id} style={{ marginBottom: 10 }}>
              <div className="row" style={{ marginBottom: 4 }}>
                <span className="grow ellipsis">{a.category.name}</span>
                <span className={`muted num ${a.state === 'over' ? 'expense' : 'warn'}`}>
                  {formatMoney(a.spentCents)} / {formatMoney(a.limitCents)}
                </span>
              </div>
              <Progress ratio={a.ratio} variant={a.state} />
            </div>
          ))}
          <Link to="/orcamento" className="muted">
            Ver todos →
          </Link>
        </Card>
      )}

      {openInvoices.length > 0 && (
        <Card title="Faturas em aberto">
          {openInvoices.map((i) => (
            <Link to={`/cartoes?cartao=${i.card.id}`} key={i.card.id} className="row" style={{ color: 'inherit' }}>
              <span className="grow ellipsis">{i.card.name}</span>
              <span className="muted">vence {dateLabel(i.due)}</span>
              <Money cents={i.cents} />
            </Link>
          ))}
        </Card>
      )}

      <Card title={mesCorrente ? 'Últimos lançamentos' : `Lançamentos de ${monthLabel(month, true)}`}>
        {recent.length === 0 &&
          (mesDoUltimo && mesDoUltimo !== month ? (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                Nenhum lançamento em {monthLabel(month, true)}. O último foi em{' '}
                {dateLabel(ultimoLancamento!)}.
              </p>
              <button className="btn sm" onClick={() => setMonth(mesDoUltimo)}>
                Ver {monthLabel(mesDoUltimo, true)}
              </button>
            </>
          ) : (
            <p className="muted">Nada lançado ainda. Toque no + para começar.</p>
          ))}
        {recent.map((t) => (
          <Link
            className="row"
            to={`/lancar?id=${t.id}`}
            key={t.id}
            style={{ color: 'inherit' }}
          >
            <div className="grow" style={{ overflow: 'hidden' }}>
              <div className="ellipsis">{t.description || catName(t.categoryId)}</div>
              <div className="muted ellipsis">
                {dateLabel(t.date)}
                {t.description ? ` · ${catName(t.categoryId)}` : ''}
                {t.installmentOf ? ` · ${t.installmentN}/${t.installmentOf}` : ''}
              </div>
            </div>
            <Money cents={t.type === 'income' ? t.amountCents : -t.amountCents} signed />
          </Link>
        ))}
        {recent.length > 0 && (
          <Link to="/historico" className="muted" style={{ display: 'block', marginTop: 10 }}>
            Ver histórico →
          </Link>
        )}
      </Card>

      <Link to="/previsao" className="btn" style={{ width: '100%' }}>
        Previsão dos próximos 3 meses →
      </Link>
    </>
  )
}
