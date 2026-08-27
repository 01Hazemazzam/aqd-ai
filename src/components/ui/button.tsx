import { cn } from './cn'
import { Spinner } from './spinner'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-surface-2 hover:opacity-90',
  secondary: 'bg-surface-2 text-ink border border-edge hover:bg-surface-3',
  ghost: 'bg-transparent text-ink-dim hover:bg-surface-3',
  danger: 'bg-transparent text-risk-high border border-risk-high hover:bg-surface-3',
}

export function Button({
  variant = 'primary',
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2',
        'text-sm font-semibold transition-opacity disabled:opacity-50',
        VARIANTS[variant],
        className,
      )}
    >
      {loading && <Spinner size={14} />}
      {children}
    </button>
  )
}
