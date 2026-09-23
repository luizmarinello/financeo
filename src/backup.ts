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

/**
 * Substitui tudo pelo conteúdo do arquivo. Valida antes de apagar qualquer
 * coisa — um JSON errado não pode levar o histórico junto.
 */
export async function importBackup(file: File): Promise<ImportResult> {
  const parsed: unknown = JSON.parse(await file.text())
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as Backup).app !== 'financas' ||
    typeof (parsed as Backup).data !== 'object'
  ) {
    throw new Error('Arquivo não é um backup deste app.')
  }
  const { data } = parsed as Backup

  let rows = 0
  for (const name of TABLES) {
    const list = data[name]
    if (list !== undefined && !Array.isArray(list)) throw new Error(`Tabela "${name}" corrompida.`)
    rows += list?.length ?? 0
  }

  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const name of TABLES) {
      await db.table(name).clear()
      const list = data[name]
      if (list?.length) await db.table(name).bulkAdd(list)
    }
  })

  return { rows }
}
