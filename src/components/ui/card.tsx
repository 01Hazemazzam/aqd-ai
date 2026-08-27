import { cn } from './cn'
export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('rounded-xl border border-edge bg-surface-2 p-6', className)}>{children}</div>
}
