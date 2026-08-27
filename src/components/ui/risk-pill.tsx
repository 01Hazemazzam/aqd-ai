import { cn } from './cn'

const LEVELS = {
  high: { glyph: '◆', word: 'HIGH', className: 'text-risk-high' },
  medium: { glyph: '▲', word: 'MEDIUM', className: 'text-risk-medium' },
  low: { glyph: '●', word: 'LOW', className: 'text-risk-low' },
  none: { glyph: '✓', word: 'NO FINDING', className: 'text-ink-dim' },
} as const

export function RiskPill({ level }: { level: keyof typeof LEVELS }) {
  const { glyph, word, className } = LEVELS[level]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full bg-surface-3 px-2.5 py-0.5', 'text-xs font-bold tracking-wide', className)}>
      <span aria-hidden="true">{glyph}</span>
      {word}
    </span>
  )
}
