import { useEffect, useRef, useState, type ReactNode } from 'react'
import { addMonths, monthLabel, thisMonth, type Month } from '../dates'
import { formatMoney, parseMoney } from '../money'

export function Topbar({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="topbar">
      <h1>{title}</h1>
      {right}
    </div>
  )
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="card">
      {title && <h2>{title}</h2>}
      {children}
    </section>
  )
}

/** Navegação de mês: ‹ set/25 ›. Não passa do mês atual + 12. */
export function MonthNav({ month, onChange }: { month: Month; onChange: (m: Month) => void }) {
  const max = addMonths(thisMonth(), 12)
  return (
    <div className="seg" style={{ gridTemplateColumns: '44px 1fr 44px' }}>
      <button onClick={() => onChange(addMonths(month, -1))} aria-label="Mês anterior">
        ‹
      </button>
      <button aria-pressed="true" onClick={() => onChange(thisMonth())}>
        {monthLabel(month, true)}
      </button>
      <button
        onClick={() => onChange(addMonths(month, 1))}
        disabled={month >= max}
        aria-label="Próximo mês"
      >
        ›
      </button>
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ value: T; label: string; className?: string }>
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={o.value}
          className={o.className}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Chips<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T | undefined
  onChange: (v: T) => void
  options: Array<{ value: T; label: string }>
}) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="chip ellipsis"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Campo de valor. Guarda o texto cru enquanto o usuário digita (senão não dá
 * para escrever "12," ) e devolve centavos a cada tecla.
 */
export function MoneyField({
  cents,
  onChange,
  autoFocus,
  className = 'amount-input',
}: {
  cents: number
  onChange: (cents: number) => void
  autoFocus?: boolean
  className?: string
}) {
  const [text, setText] = useState(() => (cents ? (cents / 100).toFixed(2).replace('.', ',') : ''))
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])

  // valor trocado por fora (atalho, edição): reflete no campo
  const lastEmitted = useRef(cents)
  useEffect(() => {
    if (cents !== lastEmitted.current) {
      setText(cents ? (cents / 100).toFixed(2).replace('.', ',') : '')
      lastEmitted.current = cents
    }
  }, [cents])

  return (
    <input
      ref={ref}
      className={className}
      type="text"
      inputMode="decimal"
      placeholder="R$ 0,00"
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const parsed = parseMoney(e.target.value) ?? 0
        lastEmitted.current = parsed
        onChange(parsed)
      }}
    />
  )
}

export function Progress({ ratio, variant }: { ratio: number; variant?: string }) {
  return <progress className={variant} value={Math.min(1, Math.max(0, ratio))} max={1} />
}

export function Sheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div className="sheet" onClick={onClose} role="dialog" aria-modal="true">
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  )
}

export function Money({ cents, signed }: { cents: number; signed?: boolean }) {
  const cls = !signed ? '' : cents > 0 ? 'income' : cents < 0 ? 'expense' : ''
  return (
    <span className={`num ${cls}`}>
      {signed && cents > 0 ? '+' : ''}
      {formatMoney(cents)}
    </span>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}
