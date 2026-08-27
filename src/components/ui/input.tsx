import { useId } from 'react'
import { cn } from './cn'

export function Input({
  label,
  error,
  hint,
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        {...rest}
        id={id}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={cn(error && errorId, hint && hintId) || undefined}
        className={cn(
          'rounded-lg border bg-surface-2 px-3 py-2 text-sm text-ink',
          'placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-accent',
          error ? 'border-risk-high' : 'border-edge',
          className,
        )}
      />
      {hint && !error && (
        <span id={hintId} className="text-xs text-ink-faint">{hint}</span>
      )}
      {error && (
        <span id={errorId} role="alert" className="text-xs text-risk-high">{error}</span>
      )}
    </div>
  )
}
