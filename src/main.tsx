import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { seed } from './db'
import './styles.css'

// HashRouter: GitHub Pages não faz fallback de rota, e o hash resolve sem
// precisar do truque do 404.html.
registerSW({ immediate: true })

// notificação clicada com o app já aberto: leva para a tela certa
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'navigate' && typeof e.data.url === 'string') {
    location.hash = e.data.url.replace(/^.*#/, '#')
  }
})

seed().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </StrictMode>,
  )
})
