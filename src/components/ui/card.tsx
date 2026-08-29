import { cn } from './cn'

export function Card({
  className,
  children,
  interactive = false,
}: {
  className?: string
  children: React.ReactNode
  /** Lifts and gains shadow on hover/focus -- for cards that are themselves a link/button trigger. */
  interactive?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-edge bg-surface-2 p-6 shadow-sm',
        'transition-[transform,box-shadow,border-color] duration-[var(--duration-base)] ease-[var(--ease-out)]',
        interactive && 'hover:-translate-y-0.5 hover:border-edge hover:shadow-md',
        className,
      )}
    >
      {children}
    </div>
  )
}
