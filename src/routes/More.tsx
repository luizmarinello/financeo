import { Link } from 'react-router-dom'
import { Card, Topbar } from '../components/ui'

const LINKS = [
  { to: '/cartoes', label: 'Cartões', hint: 'fatura, fechamento e parcelas' },
  { to: '/contas', label: 'Contas fixas', hint: 'recorrências e lembretes de vencimento' },
  { to: '/previsao', label: 'Previsão', hint: 'saldo dos próximos 3 meses' },
  { to: '/categorias', label: 'Categorias', hint: 'criar, renomear, arquivar' },
  { to: '/formas-de-pagamento', label: 'Formas de pagamento', hint: 'espécie, conta, saldo inicial' },
  { to: '/ajustes', label: 'Ajustes', hint: 'notificações, backup' },
]

export default function More() {
  return (
    <>
      <Topbar title="Mais" />
      <Card>
        {LINKS.map((l) => (
          <Link className="row" to={l.to} key={l.to} style={{ color: 'inherit' }}>
            <div className="grow">
              <div>{l.label}</div>
              <div className="muted">{l.hint}</div>
            </div>
            <span className="muted">›</span>
          </Link>
        ))}
      </Card>
    </>
  )
}
