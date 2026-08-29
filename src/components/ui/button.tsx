import { cn } from './cn'
import { Spinner } from './spinner'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-surface-2 shadow-sm hover:opacity-90 hover:shadow-md',
  secondary: 'bg-surface-2 text-ink border border-edge shadow-sm hover:bg-surface-3 hover:shadow-md',
  ghost: 'bg-transparent text-ink-dim hover:bg-surface-3 hover:text-ink',
  danger: 'bg-transparent text-risk-high border border-risk-high hover:bg-risk-high/10',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2.5',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean; icon?: React.ReactNode }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-lg font-semibold',
        'transition-[background-color,box-shadow,opacity,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]',
        'active:scale-[.97] disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none disabled:active:scale-100',
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
    >
      {loading ? <Spinner size={size === 'lg' ? 18 : 14} /> : icon}
      {children}
    </button>
  )
}
