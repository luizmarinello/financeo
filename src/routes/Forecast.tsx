import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { monthLabel, thisMonth } from '../dates'
import { formatMoney } from '../money'
import { loadForecast } from '../finance/forecast'
import { Card, Topbar } from '../components/ui'

export default function Forecast() {
  const months = useLiveQuery(() => loadForecast(3), [])
  if (!months) return null

  // Gastar mais do que entra e problema de verdade. Acumulado negativo pode
  // ser so o saldo inicial nao informado, e avisar disso como se fosse rombo
  // treina a pessoa a ignorar o aviso.
  // So meses inteiros. O mes corrente esta pela metade: perto do fim ele sempre
  // fecha negativo, porque a renda ja caiu e o gasto do resto do mes continua.
  const mesNoVermelho = months.find((m) => m.deltaCents < 0 && m.month > thisMonth())
  const soFaltaSaldoInicial = !mesNoVermelho && months.some((m) => m.endCents < 0)

  return (
    <>
      <Topbar title="Previsão" />

      {mesNoVermelho && (
        <div className="banner alert">
          Em {monthLabel(mesNoVermelho.month, true)} sai mais do que entra. Dá tempo de cortar algo
          ou adiar um aporte.
        </div>
      )}

      {soFaltaSaldoInicial && (
        <div className="banner">
          Todo mês fecha no positivo. O saldo acumulado aparece negativo só porque você ainda não
          informou quanto tem hoje, em <Link to="/formas-de-pagamento">Formas de pagamento</Link>.
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
            <span className="grow">Limites de gasto</span>
            <span className="num expense">−{formatMoney(m.budgetCents)}</span>
          </div>
          <div className="row">
            <span className="grow">Aportes planejados</span>
            <span className="num expense">−{formatMoney(m.goalsCents)}</span>
          </div>
          {/* A sobra vale por si: nao depende de quanto voce tinha antes. O
              saldo no fim do mes so faz sentido se o saldo inicial estiver
              informado, e por isso vem depois e em segundo plano. */}
          <div className="row">
            <span className="grow">
              <strong>Sobra do mês</strong>
            </span>
            <strong className={`num ${m.deltaCents < 0 ? 'expense' : 'income'}`}>
              {m.deltaCents > 0 ? '+' : ''}
              {formatMoney(m.deltaCents)}
            </strong>
          </div>
          <div className="row">
            <span className="grow muted">Saldo no fim do mês</span>
            <span className={`num muted ${m.endCents < 0 ? 'expense' : ''}`}>
              {formatMoney(m.endCents)}
            </span>
          </div>
        </Card>
      ))}

      <p className="muted">
        Parte do saldo de hoje e soma o que ainda está por vir: contas fixas, parcelas que já
        caíram em faturas futuras, os limites de gasto que você definiu no orçamento e o que
        planejou aportar nas metas. O mês corrente só conta o que ainda não venceu, e o limite de
        gasto reserva só a parte que cabe nos dias que faltam.
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
