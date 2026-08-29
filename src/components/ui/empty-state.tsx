import { cn } from './cn'

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-3 text-ink-faint">
        {icon}
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-ink">{title}</p>
        {description && <p className="max-w-xs text-sm text-ink-dim">{description}</p>}
      </div>
      {action}
    </div>
  )
}
