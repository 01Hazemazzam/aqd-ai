import { cn } from './cn'
const TONES = {
  neutral: 'bg-surface-3 text-ink-dim',
  accent: 'bg-surface-3 text-accent',
  brass: 'bg-surface-3 text-brass',
} as const
export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof TONES; children: React.ReactNode }) {
  return <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', TONES[tone])}>{children}</span>
}
