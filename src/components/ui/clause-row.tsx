import { cn } from './cn'
import { RiskPill } from './risk-pill'

const GUTTER = {
  high: 'bg-risk-high',
  medium: 'bg-risk-medium',
  low: 'bg-risk-low',
  none: 'bg-transparent',
} as const

export function ClauseRow({ id, number, heading, body, severity = 'none', dir }: {
  id?: string
  number: string
  heading: string
  body: string
  severity?: keyof typeof GUTTER
  dir?: 'ltr' | 'rtl'
}) {
  return (
    <article
      id={id}
      dir={dir}
      className={cn(
        'relative flex gap-3 rounded-xl border border-edge bg-surface-2 p-4 shadow-sm',
        'transition-[box-shadow,border-color] duration-[var(--duration-base)] ease-[var(--ease-out)]',
        'hover:border-edge hover:shadow-md',
      )}
    >
      {/* `start-0` is Tailwind's logical inset-inline-start, so the gutter
          mirrors in RTL with no second rule and no physical property. */}
      <span aria-hidden="true" className={cn('absolute start-0 top-4 bottom-4 w-[3px] rounded-full', GUTTER[severity])} />
      <span className="font-serif text-lg font-semibold leading-none text-brass">{number}</span>
      <div className="flex-1">
        <h3 className="mb-1 text-sm font-semibold text-ink">{heading}</h3>
        <p className="text-sm text-ink-dim">{body}</p>
      </div>
      {severity !== 'none' && <RiskPill level={severity} />}
    </article>
  )
}
