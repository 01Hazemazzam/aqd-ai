'use client'
import { cn } from './cn'

export function Tabs({ tabs, active, onChange }: {
  tabs: Array<{ id: string; label: string }>
  active: string
  onChange: (id: string) => void
}) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-edge">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={tab.id === active}
          onClick={() => onChange(tab.id)}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-sm',
            tab.id === active
              ? 'border-accent font-semibold text-ink'
              : 'border-transparent text-ink-dim hover:text-ink',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
