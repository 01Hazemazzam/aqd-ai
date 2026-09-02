import Link from 'next/link'
import { CalendarOff, Flag, CalendarCheck, ClipboardList } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { FadeIn, StaggerList, StaggerItem } from '@/components/ui/reveal'
import { cn } from '@/components/ui/cn'
import type { Milestone, MilestoneKind, Urgency } from '@/lib/intelligence/build'
import { formatDerivation, type DerivationStrings } from './format-derivation'

// The portfolio's dated agenda, grouped by month.
//
// An agenda, not a month grid: dates arrive only from facts the contracts
// state, so the portfolio yields tens of milestones rather than hundreds, and
// a grid would be mostly empty cells pretending otherwise.
//
// Every row shows its derivation. That is the point of the whole feature --
// a date on a legal calendar the reader cannot trace back is a date they
// should not act on.

export interface CalendarStrings extends DerivationStrings {
  empty: string
  emptyDescription: string
  kind: Record<MilestoneKind, string>
  urgency: Record<Urgency, string>
}

const KIND_ICON: Record<MilestoneKind, typeof Flag> = {
  effective_date: Flag,
  term_end: CalendarCheck,
  obligation: ClipboardList,
}

const URGENCY_TONE: Record<Urgency, string> = {
  overdue: 'text-risk-high',
  soon: 'text-risk-medium',
  upcoming: 'text-ink-faint',
}

export function CalendarView({
  milestones,
  locale,
  strings,
}: {
  milestones: Milestone[]
  locale: string
  strings: CalendarStrings
}) {
  if (milestones.length === 0) {
    return (
      <Card>
        <EmptyState icon={<CalendarOff size={22} aria-hidden="true" />} title={strings.empty} description={strings.emptyDescription} />
      </Card>
    )
  }

  const intl = locale === 'ar' ? 'ar' : 'en'
  const monthFormat = new Intl.DateTimeFormat(intl, { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const dayFormat = new Intl.DateTimeFormat(intl, { day: 'numeric', weekday: 'short', timeZone: 'UTC' })
  const isoFormat = new Intl.DateTimeFormat(intl, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const formatDate = (iso: string) => isoFormat.format(new Date(`${iso}T00:00:00Z`))

  // Milestones arrive sorted, so grouping is a single pass and each month
  // keeps chronological order without re-sorting.
  const months: Array<{ key: string; label: string; items: Milestone[] }> = []
  for (const m of milestones) {
    const key = m.date.slice(0, 7)
    const last = months.at(-1)
    if (last?.key === key) last.items.push(m)
    else months.push({ key, label: monthFormat.format(new Date(`${m.date}T00:00:00Z`)), items: [m] })
  }

  return (
    <div className="flex flex-col gap-8">
      {months.map((month, mi) => (
        <FadeIn key={month.key} delay={Math.min(mi, 4) * 0.04}>
          <section>
            <h2 className="mb-3 text-sm font-semibold text-ink">{month.label}</h2>
            <StaggerList className="flex flex-col gap-2">
              {month.items.map((m, i) => {
                const Icon = KIND_ICON[m.kind]
                const tone = m.urgency === 'overdue' && !m.missable ? URGENCY_TONE.upcoming : URGENCY_TONE[m.urgency]
                const derivation = formatDerivation(m.derivation, strings, formatDate, m.termLength)
                return (
                  <StaggerItem key={`${m.contractId}-${m.kind}-${m.date}-${i}`}>
                    <Link
                      href={m.clauseId ? `/contracts/${m.contractId}#clause-${m.clauseId}` : `/contracts/${m.contractId}`}
                      className="flex items-start gap-3.5 rounded-lg border border-edge bg-surface p-3.5 transition-colors hover:bg-surface-2"
                    >
                      <div className="w-16 shrink-0 text-center">
                        <p className={cn('text-sm font-semibold tabular-nums', tone)}>
                          {dayFormat.format(new Date(`${m.date}T00:00:00Z`))}
                        </p>
                      </div>

                      <div className="min-w-0 flex-1 border-s border-edge ps-3.5">
                        <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-ink-faint">
                          <Icon size={12} aria-hidden="true" />
                          {strings.kind[m.kind]}
                        </p>
                        <p dir="auto" className="mt-1 text-sm font-medium text-ink">
                          {m.label}
                        </p>
                        {/* A lifecycle milestone's label IS its contract, so
                            repeating it underneath would say the same thing
                            twice. */}
                        {m.label !== m.contractTitle && (
                          <p dir="auto" className="mt-0.5 text-xs text-ink-dim">
                            {m.contractTitle}
                          </p>
                        )}
                        {derivation && (
                          <p dir="auto" className="mt-1.5 text-[11px] text-ink-faint">
                            {strings.derivedFrom} {derivation}
                          </p>
                        )}
                      </div>

                      {/* Only a duty can be late. A contract's effective date
                          having passed means it started, and its term end
                          having passed means it renewed -- badging either
                          "overdue" would mark every running contract. */}
                      {m.urgency !== 'upcoming' && (m.missable || m.urgency === 'soon') && (
                        <span className={cn('shrink-0 text-[11px] font-medium', tone)}>
                          {strings.urgency[m.urgency]}
                        </span>
                      )}
                    </Link>
                  </StaggerItem>
                )
              })}
            </StaggerList>
          </section>
        </FadeIn>
      ))}
    </div>
  )
}
