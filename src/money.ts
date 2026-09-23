const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export const formatMoney = (cents: number) => BRL.format(cents / 100)

/** Versão curta para cards apertados: R$ 1,2 mil / R$ 1,2 M */
export function formatMoneyShort(cents: number) {
  const abs = Math.abs(cents)
  if (abs >= 100_000_00) return `${cents < 0 ? '-' : ''}R$ ${(abs / 100_000_0).toFixed(1).replace('.', ',')} M`
  if (abs >= 10_000_00) return `${cents < 0 ? '-' : ''}R$ ${(abs / 100_0).toFixed(1).replace('.', ',')} mil`
  return BRL.format(cents / 100)
}

/**
 * Lê o que o usuário digitou como centavos. Aceita "12", "12,50", "1.234,56",
 * "1234.56" e "R$ 12,50". Retorna null se não der para ler.
 */
export function parseMoney(input: string): number | null {
  const s = input.replace(/[^\d,.-]/g, '').trim()
  if (!s || s === '-' || s === ',' || s === '.') return null
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  const sep = Math.max(lastComma, lastDot)
  // separador decimal = o último, e só se tiver 1 ou 2 dígitos depois dele
  const decimals = sep >= 0 && s.length - sep - 1 <= 2 ? s.length - sep - 1 : 0
  const digits = (decimals ? s.slice(0, sep) + s.slice(sep + 1) : s).replace(/[,.]/g, '')
  const n = Number(digits)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 10 ** (2 - decimals))
}

/**
 * Divide um total em N parcelas sem perder centavo: as primeiras parcelas
 * absorvem o resto da divisão.
 */
export function splitInstallments(totalCents: number, n: number): number[] {
  const base = Math.floor(Math.abs(totalCents) / n)
  const rest = Math.abs(totalCents) - base * n
  const sign = Math.sign(totalCents) || 1
  return Array.from({ length: n }, (_, i) => sign * (base + (i < rest ? 1 : 0)))
}
