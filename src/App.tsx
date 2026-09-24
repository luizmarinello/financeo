import { NavLink, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import Home from './routes/Home'
import Add from './routes/Add'
import History from './routes/History'
import Budget from './routes/Budget'
import Goals from './routes/Goals'
import More from './routes/More'
import Cards from './routes/Cards'
import Bills from './routes/Bills'
import Categories from './routes/Categories'
import Accounts from './routes/Accounts'
import Forecast from './routes/Forecast'
import Settings from './routes/Settings'
import Import from './routes/Import'

const NAV = [
  { to: '/', label: 'Início', d: 'M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z' },
  { to: '/historico', label: 'Histórico', d: 'M4 5h16M4 12h16M4 19h10' },
  { to: '/orcamento', label: 'Orçamento', d: 'M4 19V9m5 10V5m5 14v-7m5 7V8' },
  { to: '/metas', label: 'Metas', d: 'M12 3v18M3 12h18M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z' },
  { to: '/mais', label: 'Mais', d: 'M5 12h.01M12 12h.01M19 12h.01' },
]

export default function App() {
  const nav = useNavigate()
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  // lançar a partir de um mês aberto cai naquele mês, não em hoje
  const mes = params.get('mes')
  const showFab = pathname !== '/lancar' && pathname !== '/importar'

  return (
    <>
      <div className="app">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/lancar" element={<Add />} />
          <Route path="/historico" element={<History />} />
          <Route path="/orcamento" element={<Budget />} />
          <Route path="/metas" element={<Goals />} />
          <Route path="/mais" element={<More />} />
          <Route path="/cartoes" element={<Cards />} />
          <Route path="/contas" element={<Bills />} />
          <Route path="/categorias" element={<Categories />} />
          <Route path="/formas-de-pagamento" element={<Accounts />} />
          <Route path="/previsao" element={<Forecast />} />
          <Route path="/ajustes" element={<Settings />} />
          {/* destino do "Compartilhar" do Android; ver share_target no manifest */}
          <Route path="/importar" element={<Import />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </div>

      {showFab && (
        <button
          className="fab"
          onClick={() => nav(mes ? `/lancar?mes=${mes}` : '/lancar')}
          aria-label="Novo lançamento"
        >
          +
        </button>
      )}

      <nav className="nav" style={{ gridTemplateColumns: `repeat(${NAV.length}, 1fr)` }}>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={n.d} />
            </svg>
            {n.label}
          </NavLink>
        ))}
      </nav>
    </>
  )
}
