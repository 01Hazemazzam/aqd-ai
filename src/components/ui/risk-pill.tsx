import { cn } from './cn'

const LEVELS = {
  high: { glyph: '◆', word: 'HIGH', color: 'var(--risk-high)' },
  medium: { glyph: '▲', word: 'MEDIUM', color: 'var(--risk-medium)' },
  low: { glyph: '●', word: 'LOW', color: 'var(--risk-low)' },
  none: { glyph: '✓', word: 'NO FINDING', color: 'var(--ink-dim)' },
} as const

export function RiskPill({ level }: { level: keyof typeof LEVELS }) {
  const { glyph, word, color } = LEVELS[level]
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5', 'text-xs font-bold tracking-wide')}
      style={{
        color,
        borderColor: `color-mix(in oklch, ${color} 35%, transparent)`,
        backgroundColor: `color-mix(in oklch, ${color} 12%, var(--surface-2))`,
      }}
    >
      <span aria-hidden="true">{glyph}</span>
      {word}
    </span>
  )
}
