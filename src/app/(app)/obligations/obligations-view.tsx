import Link from 'next/link'
import { CalendarClock, CalendarX2, ChevronRight } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { FadeIn, StaggerList, StaggerItem } from '@/components/ui/reveal'
import type { DatedObligation, RawObligation, Urgency } from '@/lib/obligations/register'

// Resolved (already-translated) strings, so this view carries no assumption
// about the i18n key layout -- the same "text in, UI out" shape the chat
// widget uses. Keeps the view previewable and unit-testable without a
// next-intl provider.
export interface ObligationsStrings {
  title: string
  subtitle: string
  empty: string
  upcomingTitle: string
  conditionalTitle: string
  noDeadline: string
  urgency: Record<Urgency, string>
}

const URGENCY_COLOR: Record<Urgency, string> = {
  overdue: 'var(--risk-high)',
  soon: 'var(--risk-medium)',
  upcoming: 'var(--accent)',
}

export function ObligationsView({
  dated,
  conditional,
  locale,
  strings,
}: {
  dated: DatedObligation[]
  conditional: RawObligation[]
  locale: string
  strings: ObligationsStrings
}) {
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
  const isEmpty = dated.length === 0 && conditional.length === 0

  return (
    <main className="mx-auto max-w-3xl px-6 py-20 sm:px-10">
      <FadeIn>
        <h1 className="font-serif text-3xl font-medium tracking-tight text-ink text-balance">{strings.title}</h1>
        <p className="mt-2 text-sm text-ink-dim">{strings.subtitle}</p>
      </FadeIn>

      {isEmpty && (
        <Card className="mt-8">
          <EmptyState icon={<CalendarClock size={22} aria-hidden="true" />} title={strings.empty} />
        </Card>
      )}

      {dated.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
            <CalendarClock size={15} aria-hidden="true" className="text-accent" />
            {strings.upcomingTitle}
          </h2>
          <StaggerList className="flex flex-col gap-3">
            {dated.map((o, i) => (
              <StaggerItem key={`${o.contractId}-${i}`}>
                <Link href={`/contracts/${o.contractId}`}>
                  <Card interactive className="flex items-center justify-between gap-4 py-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="h-10 w-1 shrink-0 rounded-full"
                        style={{ backgroundColor: URGENCY_COLOR[o.urgency] }}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm text-ink" dir="auto">
                          <span className="font-medium">{o.obligor}</span>: {o.action}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-ink-faint" dir="auto">{o.contractTitle}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span
                        className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                        style={{
                          color: URGENCY_COLOR[o.urgency],
                          backgroundColor: `color-mix(in oklch, ${URGENCY_COLOR[o.urgency]} 12%, var(--surface-2))`,
                        }}
                      >
                        {strings.urgency[o.urgency]}
                      </span>
                      <span className="whitespace-nowrap text-xs tabular-nums text-ink-dim">
                        {dateFmt.format(new Date(`${o.dueDate}T00:00:00Z`))}
                      </span>
                    </div>
                  </Card>
                </Link>
              </StaggerItem>
            ))}
          </StaggerList>
        </section>
      )}

      {conditional.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
            <CalendarX2 size={15} aria-hidden="true" className="text-ink-faint" />
            {strings.conditionalTitle}
          </h2>
          <StaggerList className="flex flex-col gap-3">
            {conditional.map((o, i) => (
              <StaggerItem key={`${o.contractId}-${i}`}>
                <Link href={`/contracts/${o.contractId}`}>
                  <Card interactive className="flex items-center justify-between gap-4 py-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink" dir="auto">
                        <span className="font-medium">{o.obligor}</span>: {o.action}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-ink-faint" dir="auto">{o.contractTitle}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span dir="auto" className="max-w-[10rem] truncate text-xs text-ink-dim">
                        {o.due ?? strings.noDeadline}
                      </span>
                      <ChevronRight size={16} aria-hidden="true" className="text-ink-faint rtl:-scale-x-100" />
                    </div>
                  </Card>
                </Link>
              </StaggerItem>
            ))}
          </StaggerList>
        </section>
      )}
    </main>
  )
}
