import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { aplicarBackup, lerBackup, type ResumoDoBackup } from '../backup'
import { syncScheduleSoon } from '../notify'
import { Card, Topbar } from '../components/ui'

/** Os mesmos nomes usados pelo service worker ao guardar o arquivo. */
const CACHE_COMPARTILHADO = 'financeo-compartilhado'
const ARQUIVO_COMPARTILHADO = 'arquivo-recebido'

type Estado =
  | { fase: 'lendo' }
  | { fase: 'erro'; mensagem: string }
  | { fase: 'confirmar'; nome: string; resumo: ResumoDoBackup; data: Parameters<typeof aplicarBackup>[0] }
  | { fase: 'gravando' }
  | { fase: 'pronto'; rows: number }

/**
 * Tela do arquivo que chegou pelo "Compartilhar" do Android.
 *
 * Ela existe para não importar nada sozinha: importar apaga todos os dados do
 * aparelho, e um arquivo vindo de fora é a última coisa que deveria fazer isso
 * sem você ver o que tem dentro.
 */
export default function Import() {
  const nav = useNavigate()
  const [estado, setEstado] = useState<Estado>({ fase: 'lendo' })

  useEffect(() => {
    let ativo = true
    ;(async () => {
      try {
        const cache = await caches.open(CACHE_COMPARTILHADO)
        const resposta = await cache.match(ARQUIVO_COMPARTILHADO)
        if (!resposta) {
          if (ativo) setEstado({ fase: 'erro', mensagem: 'Não recebi nenhum arquivo.' })
          return
        }
        const nome = resposta.headers.get('x-nome') ?? 'backup.json'
        const { data, resumo } = lerBackup(await resposta.text())
        if (ativo) setEstado({ fase: 'confirmar', nome, resumo, data })
      } catch (e) {
        if (ativo) setEstado({ fase: 'erro', mensagem: e instanceof Error ? e.message : 'Arquivo inválido.' })
      }
    })()
    return () => {
      ativo = false
    }
  }, [])

  /** O arquivo é descartado de qualquer jeito: importado ou recusado. */
  async function descartar() {
    const cache = await caches.open(CACHE_COMPARTILHADO)
    await cache.delete(ARQUIVO_COMPARTILHADO)
  }

  async function importar() {
    if (estado.fase !== 'confirmar') return
    setEstado({ fase: 'gravando' })
    try {
      const { rows } = await aplicarBackup(estado.data)
      await descartar()
      syncScheduleSoon()
      setEstado({ fase: 'pronto', rows })
    } catch (e) {
      setEstado({ fase: 'erro', mensagem: e instanceof Error ? e.message : 'Não consegui gravar.' })
    }
  }

  return (
    <>
      <Topbar title="Arquivo recebido" />

      {estado.fase === 'lendo' && <Card>Lendo o arquivo…</Card>}

      {estado.fase === 'erro' && (
        <>
          <div className="banner alert">{estado.mensagem}</div>
          <button
            className="btn primary"
            onClick={async () => {
              await descartar()
              nav('/', { replace: true })
            }}
          >
            Voltar
          </button>
        </>
      )}

      {estado.fase === 'confirmar' && (
        <>
          <Card title={estado.nome}>
            {estado.resumo.porTabela.map((t) => (
              <div className="row" key={t.tabela}>
                <span className="grow">{t.tabela}</span>
                <span className="num">{t.total}</span>
              </div>
            ))}
            {estado.resumo.exportadoEm && (
              <p className="muted" style={{ marginBottom: 0 }}>
                Exportado em {new Date(estado.resumo.exportadoEm).toLocaleString('pt-BR')}
              </p>
            )}
          </Card>

          <div className="banner alert">
            Importar <strong>apaga tudo o que já está neste aparelho</strong> e põe o conteúdo do
            arquivo no lugar. Não dá para desfazer.
          </div>

          <button className="btn primary" onClick={importar}>
            Substituir meus dados
          </button>
          <button
            className="btn ghost"
            style={{ width: '100%', marginTop: '0.5rem' }}
            onClick={async () => {
              await descartar()
              nav('/', { replace: true })
            }}
          >
            Cancelar
          </button>
        </>
      )}

      {estado.fase === 'gravando' && <Card>Gravando…</Card>}

      {estado.fase === 'pronto' && (
        <>
          <Card>
            <p style={{ margin: 0 }}>Pronto: {estado.rows} registros importados.</p>
          </Card>
          <button className="btn primary" onClick={() => nav('/', { replace: true })}>
            Ver o app
          </button>
        </>
      )}
    </>
  )
}
