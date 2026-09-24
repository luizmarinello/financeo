import { db } from './db'
import { today } from './dates'

const TABLES = [
  'transactions',
  'categories',
  'accounts',
  'cards',
  'budgets',
  'goals',
  'bills',
  'shortcuts',
  'invoicePayments',
] as const

interface Backup {
  app: 'financas'
  version: 1
  exportedAt: string
  data: Record<string, unknown[]>
}

export async function exportBackup() {
  const data: Record<string, unknown[]> = {}
  for (const name of TABLES) data[name] = await db.table(name).toArray()

  const backup: Backup = { app: 'financas', version: 1, exportedAt: new Date().toISOString(), data }
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
  )
  const a = document.createElement('a')
  a.href = url
  a.download = `financas-${today()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export interface ImportResult {
  rows: number
}

/** O que o arquivo traz, para mostrar ANTES de substituir qualquer coisa. */
export interface ResumoDoBackup {
  rows: number
  exportadoEm?: string
  /** só as tabelas que vieram com conteúdo, para caber na tela */
  porTabela: Array<{ tabela: string; total: number }>
}

const ROTULOS: Record<string, string> = {
  transactions: 'lançamentos',
  categories: 'categorias',
  accounts: 'formas de pagamento',
  cards: 'cartões',
  budgets: 'limites de gasto',
  goals: 'metas',
  bills: 'contas fixas',
  shortcuts: 'atalhos',
  invoicePayments: 'faturas pagas',
}

/**
 * Lê e valida sem tocar no banco. Separado de propósito: importar substitui
 * TUDO, então é preciso poder mostrar o que veio antes de apagar o que existe.
 * Vale mais ainda para arquivo que chegou de fora, pelo compartilhamento.
 */
export function lerBackup(texto: string): { data: Backup['data']; resumo: ResumoDoBackup } {
  let parsed: unknown
  try {
    parsed = JSON.parse(texto)
  } catch {
    throw new Error('O arquivo não é um JSON válido.')
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as Backup).app !== 'financas' ||
    typeof (parsed as Backup).data !== 'object'
  ) {
    throw new Error('Arquivo não é um backup deste app.')
  }
  const { data, exportedAt } = parsed as Backup

  let rows = 0
  const porTabela: ResumoDoBackup['porTabela'] = []
  for (const name of TABLES) {
    const list = data[name]
    if (list !== undefined && !Array.isArray(list)) throw new Error(`Tabela "${name}" corrompida.`)
    const total = list?.length ?? 0
    rows += total
    if (total) porTabela.push({ tabela: ROTULOS[name] ?? name, total })
  }
  if (!rows) throw new Error('O backup está vazio.')

  return { data, resumo: { rows, exportadoEm: exportedAt, porTabela } }
}

/** Substitui tudo. Só chame depois de `lerBackup` e de confirmar com o usuário. */
export async function aplicarBackup(data: Backup['data']): Promise<ImportResult> {
  let rows = 0
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const name of TABLES) {
      await db.table(name).clear()
      const list = data[name]
      if (list?.length) {
        await db.table(name).bulkAdd(list)
        rows += list.length
      }
    }
  })
  return { rows }
}

/** Caminho do botão Importar: lê, valida e grava de uma vez. */
export async function importBackup(file: File): Promise<ImportResult> {
  const { data } = lerBackup(await file.text())
  return aplicarBackup(data)
}
