import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { monthLabel } from '../dates'
import { formatMoney } from '../money'
import { loadForecast } from '../finance/forecast'
import { Card, Topbar } from '../components/ui'

export default function Forecast() {
  const months = useLiveQuery(() => loadForecast(3), [])
  if (!months) return null

  const worst = Math.min(...months.map((m) => m.endCents))

  return (
    <>
      <Topbar title="Previsão" />

      {worst < 0 && (
        <div className="banner alert">
          A projeção fica negativa em algum mês. Dá tempo de cortar algo ou adiar um aporte.
        </div>
      )}

      {months.map((m) => (
        <Card key={m.month} title={monthLabel(m.month, true)}>
          <div className="row">
            <span className="grow">Entradas previstas</span>
            <span className="num income">{formatMoney(m.incomeCents)}</span>
          </div>
          <div className="row">
            <span className="grow">Contas fixas</span>
            <span className="num expense">−{formatMoney(m.billsCents)}</span>
          </div>
          <div className="row">
            <span className="grow">Faturas de cartão</span>
            <span className="num expense">−{formatMoney(m.invoiceCents)}</span>
          </div>
          <div className="row">
            <span className="grow">Aportes planejados</span>
            <span className="num expense">−{formatMoney(m.goalsCents)}</span>
          </div>
          <div className="row">
            <span className="grow">
              <strong>Saldo no fim do mês</strong>
            </span>
            <strong className={`num ${m.endCents < 0 ? 'expense' : ''}`}>
              {formatMoney(m.endCents)}
            </strong>
          </div>
        </Card>
      ))}

      <p className="muted">
        Parte do saldo de hoje e soma o que ainda está por vir: contas fixas cadastradas, parcelas
        que já caíram em faturas futuras e o que você planejou aportar nas metas. O mês corrente só
        conta o que ainda não venceu.
      </p>
      <div className="field-row">
        <Link to="/contas" className="btn">
          Contas fixas
        </Link>
        <Link to="/metas" className="btn">
          Metas
        </Link>
      </div>
    </>
  )
}
