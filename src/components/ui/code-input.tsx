'use client'
import { useRef, useId } from 'react'
import { cn } from './cn'

export function CodeInput({
  length = 6,
  value,
  onChange,
  error,
  label,
}: {
  length?: number
  value: string
  onChange: (v: string) => void
  error?: string
  label: string
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([])
  const id = useId()
  const errorId = `${id}-error`

  const setDigit = (index: number, digit: string) => {
    if (digit && !/^\d$/.test(digit)) return
    const next = value.padEnd(length, ' ').split('')
    next[index] = digit
    onChange(next.join('').trimEnd())
    if (digit && index < length - 1) refs.current[index + 1]?.focus()
  }

  const onKeyDown = (index: number) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !value[index] && index > 0) refs.current[index - 1]?.focus()
  }

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length)
    if (!pasted) return
    e.preventDefault()
    onChange(pasted)
    refs.current[Math.min(pasted.length, length - 1)]?.focus()
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-ink">{label}</span>
      <div className="flex gap-2" role="group" aria-label={label}>
        {Array.from({ length }, (_, i) => (
          <input
            key={i}
            ref={(el) => { refs.current[i] = el }}
            type="text"
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={1}
            value={value[i] ?? ''}
            aria-label={`Digit ${i + 1}`}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => setDigit(i, e.target.value)}
            onKeyDown={onKeyDown(i)}
            onPaste={onPaste}
            className={cn(
              'h-12 w-10 rounded-lg border bg-surface-2 text-center text-lg font-semibold text-ink shadow-sm',
              'tabular-nums transition-[border-color,transform] duration-[var(--duration-fast)]',
              'focus-visible:scale-105 focus-visible:outline-2 focus-visible:outline-accent',
              error ? 'border-risk-high' : value[i] ? 'border-brass' : 'border-edge',
            )}
          />
        ))}
      </div>
      {error && <span id={errorId} role="alert" className="text-xs text-risk-high">{error}</span>}
    </div>
  )
}
