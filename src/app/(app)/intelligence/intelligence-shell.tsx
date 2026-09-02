import Link from 'next/link'
import { AlertTriangle, CalendarDays, ClipboardList, MessagesSquare, ShieldAlert, Radar } from 'lucide-react'
import { cn } from '@/components/ui/cn'
import { FadeIn } from '@/components/ui/reveal'
import type { View } from './page'

// The section frame: heading, view switcher, and the outdated-analysis notice.
//
// The switcher is a set of links on `?view=`, not client state, so every view
// is server-rendered, deep-linkable, and shareable -- and so the old /risk and
// /obligations URLs have somewhere exact to redirect to.

const ICON: Record<View, typeof Radar> = {
  attention: Radar,
  calendar: CalendarDays,
  obligations: ClipboardList,
  risk: ShieldAlert,
  ask: MessagesSquare,
}

const ORDER: readonly View[] = ['attention', 'calendar', 'obligations', 'risk', 'ask']

export interface ShellStrings {
  title: string
  subtitle: string
  views: Record<View, string>
  /** ICU-style template containing `{count}`. */
  outdatedNotice: string
}

export function IntelligenceShell({
  view,
  strings,
  outdated,
  children,
}: {
  view: View
  strings: ShellStrings
  outdated: number
  children: React.ReactNode
}) {
  return (
    <main className="mx-auto max-w-5xl px-6 py-20 sm:px-10">
      <FadeIn>
        <h1 className="text-balance font-serif text-3xl font-medium tracking-tight text-ink">{strings.title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-dim">{strings.subtitle}</p>
      </FadeIn>

      <nav aria-label={strings.title} className="mt-8 flex flex-wrap gap-1.5 border-b border-edge pb-px">
        {ORDER.map((key) => {
          const Icon = ICON[key]
          const active = key === view
          return (
            <Link
              key={key}
              href={`/intelligence?view=${key}`}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-t-lg border border-b-0 px-3.5 py-2 text-sm font-medium',
                'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]',
                active
                  ? 'border-edge bg-surface-2 text-ink'
                  : 'border-transparent text-ink-faint hover:bg-surface-2 hover:text-ink-dim',
              )}
            >
              <Icon size={15} aria-hidden="true" />
              {strings.views[key]}
            </Link>
          )
        })}
      </nav>

      {/* Explains an empty calendar rather than leaving it mysterious: an
          analysis produced before deadlines were extracted has none, and the
          fix is a re-analysis the user has to ask for. */}
      {outdated > 0 && (
        <div className="mt-6 flex items-start gap-2.5 rounded-lg border border-edge bg-surface-2 p-3.5">
          <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-risk-medium" />
          <p role="status" className="text-sm leading-relaxed text-ink-dim">
            {strings.outdatedNotice.replace('{count}', String(outdated))}
          </p>
        </div>
      )}

      <div className="mt-8">{children}</div>
    </main>
  )
}
