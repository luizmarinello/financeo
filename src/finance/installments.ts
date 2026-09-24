import { addMonths, dateIn, dayOf, monthOf } from '../dates'
import type { ISODate, Transaction } from '../db'

/**
 * Quando cada parcela pesa no seu mês: a parcela N cai N meses depois da
 * compra, mantendo o dia.
 *
 * Não confundir com o mês da FATURA, que pode estar deslocado: comprar dia 22
 * num cartão que fechou dia 20 gera parcelas em set/out/nov, mas faturas em
 * out/nov/dez. Usar o mês da fatura como data faz a segunda parcela pular um
 * mês e deixa um mês inteiro zerado no resumo de gastos.
 *
 * Este módulo não importa o `db` em runtime (só os tipos), porque o próprio
 * `db.ts` o usa na migração — importar de volta criaria um ciclo.
 */
export function installmentDates(purchase: ISODate, n: number): ISODate[] {
  const mes = monthOf(purchase)
  const dia = dayOf(purchase)
  return Array.from({ length: n }, (_, i) => dateIn(addMonths(mes, i), dia))
}

export interface CorrecaoDeParcela {
  id: string
  de: ISODate
  para: ISODate
}

/**
 * Recalcula as datas de compras parceladas gravadas com o bug antigo.
 *
 * A parcela 1 sempre teve a data certa (a da compra), então ela é a âncora.
 * Se ela não existe mais — apagada à mão —, não dá para saber a data real da
 * compra, e o grupo fica como está: chutar seria pior do que não mexer.
 */
export function corrigirParcelas(rows: Transaction[]): CorrecaoDeParcela[] {
  const grupos = new Map<string, Transaction[]>()
  for (const t of rows) {
    if (!t.purchaseId) continue
    const g = grupos.get(t.purchaseId) ?? []
    g.push(t)
    grupos.set(t.purchaseId, g)
  }

  const correcoes: CorrecaoDeParcela[] = []
  for (const grupo of grupos.values()) {
    const primeira = grupo.find((t) => t.installmentN === 1)
    if (!primeira) continue

    const total = primeira.installmentOf ?? grupo.length
    const datas = installmentDates(primeira.date, total)

    for (const t of grupo) {
      const i = (t.installmentN ?? 1) - 1
      const nova = datas[i]
      if (nova && nova !== t.date) correcoes.push({ id: t.id, de: t.date, para: nova })
    }
  }
  return correcoes
}
