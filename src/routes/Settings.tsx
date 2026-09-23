import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { dateLabel } from '../dates'
import { formatMoney } from '../money'
import { exportBackup, importBackup } from '../backup'
import {
  disablePush,
  enablePush,
  isIOS,
  isStandalone,
  lastSyncedAt,
  notificationsSupported,
  pushConfigured,
  pushEnabled,
  syncSchedule,
} from '../notify'
import { buildSchedule, type Reminder } from '../finance/schedule'
import { Card, Topbar } from '../components/ui'

export default function Settings() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [synced, setSynced] = useState<string | null>(null)
  const [preview, setPreview] = useState<Reminder[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const shortcuts = useLiveQuery(() => db.shortcuts.orderBy('uses').reverse().toArray(), [], [])

  useEffect(() => {
    pushEnabled().then(setEnabled)
    lastSyncedAt().then(setSynced)
    buildSchedule().then((r) => setPreview(r.slice(0, 5)))
  }, [])

  async function toggle() {
    setBusy(true)
    setMsg(null)
    try {
      if (enabled) {
        await disablePush()
        setEnabled(false)
      } else {
        const r = await enablePush()
        setEnabled(r.ok)
        if (!r.ok) setMsg(r.reason ?? 'Não deu para ativar.')
        else setSynced(await lastSyncedAt())
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Erro ao falar com o servidor.')
    } finally {
      setBusy(false)
    }
  }

  async function onImport(file: File) {
    if (!confirm('Isto substitui TODOS os dados atuais pelo backup. Continuar?')) return
    try {
      const { rows } = await importBackup(file)
      setMsg(`Backup restaurado: ${rows} registros.`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Arquivo inválido.')
    }
  }

  const iosBlocked = isIOS() && !isStandalone()

  return (
    <>
      <Topbar title="Ajustes" />

      {/* resposta de ação fica no topo: no rodapé passava despercebida */}
      {msg && (
        <div className="banner" role="status">
          {msg}
        </div>
      )}

      <Card title="Notificações">
        {!notificationsSupported() && (
          <p className="muted">Este navegador não suporta notificações push.</p>
        )}

        {iosBlocked && (
          <div className="banner alert">
            No iPhone, o push só funciona com o app instalado: toque em Compartilhar → Adicionar à
            Tela de Início, e abra por lá.
          </div>
        )}

        {!pushConfigured() && (
          <div className="banner">
            Servidor de push não configurado. Sem ele, o alerta de orçamento ainda funciona (é
            local), mas o lembrete de vencimento não chega com o app fechado. Veja o README.
          </div>
        )}

        <div className="row">
          <div className="grow">
            <div>Lembretes de vencimento</div>
            <div className="muted">
              {enabled === null
                ? '…'
                : enabled
                  ? `Ativos${synced ? ` · agenda enviada ${new Date(synced).toLocaleString('pt-BR')}` : ''}`
                  : 'Desativados'}
            </div>
          </div>
          <button className="btn sm" onClick={toggle} disabled={busy || !notificationsSupported()}>
            {busy ? '…' : enabled ? 'Desativar' : 'Ativar'}
          </button>
        </div>

        {enabled && (
          <button
            className="btn sm ghost"
            style={{ marginTop: 10 }}
            onClick={async () => {
              setBusy(true)
              try {
                await syncSchedule()
                setSynced(await lastSyncedAt())
                setMsg('Agenda reenviada.')
              } catch {
                setMsg('Não consegui falar com o servidor agora.')
              } finally {
                setBusy(false)
              }
            }}
          >
            Reenviar agenda agora
          </button>
        )}

        <p className="muted" style={{ marginTop: 12 }}>
          O alerta de orçamento é local: dispara na hora do lançamento, sem passar por servidor
          nenhum. Só o lembrete de vencimento precisa do servidor, e sobe apenas como “quando, título
          e texto”.
        </p>
      </Card>

      {preview.length > 0 && (
        <Card title="Próximos lembretes">
          {preview.map((r) => (
            <div className="row" key={r.id}>
              <div className="grow" style={{ overflow: 'hidden' }}>
                <div className="ellipsis">{r.title}</div>
                <div className="muted ellipsis">{r.body}</div>
              </div>
              <span className="muted">{dateLabel(r.sendAt)}</span>
            </div>
          ))}
          <p className="muted" style={{ marginBottom: 0 }}>
            É exatamente isto que vai para o servidor — nada além.
          </p>
        </Card>
      )}

      {shortcuts.length > 0 && (
        <Card title="Atalhos">
          {shortcuts.map((s) => (
            <div className="row" key={s.id}>
              <span className="grow ellipsis">{s.label}</span>
              <span className="num muted">{formatMoney(s.amountCents)}</span>
              <button className="btn sm ghost danger" onClick={() => db.shortcuts.delete(s.id)}>
                Remover
              </button>
            </div>
          ))}
        </Card>
      )}

      <Card title="Backup">
        <p className="muted" style={{ marginTop: 0 }}>
          Os dados ficam só neste aparelho. Se limpar os dados do navegador, eles somem — exporte de
          vez em quando.
        </p>
        <div className="field-row">
          <button className="btn" onClick={exportBackup}>
            Exportar JSON
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Importar
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void onImport(file)
            e.target.value = ''
          }}
        />
      </Card>

    </>
  )
}
