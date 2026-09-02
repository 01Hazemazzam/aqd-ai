'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ClipboardList } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { FadeIn, StaggerList, StaggerItem } from '@/components/ui/reveal'
import { cn } from '@/components/ui/cn'
import type { TrackedObligation } from '@/lib/intelligence/build'
import type { PartyRole } from '@/lib/intelligence/party-role'
import type { ResolutionStatus, UnresolvedReason } from '@/lib/intelligence/due-spec'
import { formatDerivation, type DerivationStrings } from './format-derivation'

// Every obligation in the portfolio, filterable by whether its deadline
// resolved and by who owes it.
//
// The filter is deliberately on resolution STATUS rather than on a date
// range: with most deadlines anchored to events the contract never dates, "no
// date, and here is why" is the majority answer and hiding it behind an empty
// calendar would misrepresent the portfolio. The reason is shown in words, so
// an unresolved deadline reads as a fact about the document rather than as a
// gap in the product.

export interface ObligationStrings extends DerivationStrings {
  empty: string
  emptyDescription: string
  filterAll: string
  noMatches: string
  noDeadline: string
  statedAs: string
  /** Label for the document's own wording of the obligor. */
  obligorAs: string
  status: Record<ResolutionStatus, string>
  reason: Record<UnresolvedReason, string>
  role: Record<PartyRole, string>
  partyNames: Record<string, string[]>
}

type Filter = ResolutionStatus | 'all'

const ORDER: readonly ResolutionStatus[] = ['resolved', 'unresolved', 'no_deadline_stated']

const STATUS_TONE: Record<ResolutionStatus, string> = {
  resolved: 'text-risk-low',
  unresolved: 'text-risk-medium',
  no_deadline_stated: 'text-ink-faint',
}

// Who owes the duty, said one consistent way -- plus the document's own words
// when they differ.
//
// QA found the register listing "either party", "Either party", "both
// parties" and "The affected party" as four separate actors, which makes the
// list read as though four different people owe something. The normalized
// label is what the reader scans; the verbatim obligor is still shown beside
// it, because the document's wording is the fact and the label is our reading
// of it. When an obligor maps to nothing -- "Any renewal-term pricing", which
// the extractor mistook for an actor -- the verbatim text stands alone rather
// than being dressed up as a party.
function roleLabel(o: TrackedObligation, strings: ObligationStrings): { label: string; original: string | null } {
  const verbatim = o.obligor?.trim() ?? ''
  if (o.role === null) return { label: verbatim, original: null }

  const label =
    o.role === 'both' || o.role === 'third_party'
      ? strings.role[o.role]
      : ((strings.partyNames[o.contractId] ?? [])[o.role === 'party_a' ? 0 : 1] || verbatim)

  return { label, original: label.toLowerCase() === verbatim.toLowerCase() ? null : verbatim || null }
}

export function ObligationsView({
  obligations,
  locale,
  strings,
}: {
  obligations: TrackedObligation[]
  locale: string
  strings: ObligationStrings
}) {
  const [filter, setFilter] = useState<Filter>('all')

  if (obligations.length === 0) {
    return (
      <Card>
        <EmptyState icon={<ClipboardList size={22} aria-hidden="true" />} title={strings.empty} description={strings.emptyDescription} />
      </Card>
    )
  }

  const counts: Record<ResolutionStatus, number> = { resolved: 0, unresolved: 0, no_deadline_stated: 0 }
  for (const o of obligations) counts[o.resolution.status]++

  const shown = filter === 'all' ? obligations : obligations.filter((o) => o.resolution.status === filter)

  const dateFormat = new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const formatDate = (iso: string) => dateFormat.format(new Date(`${iso}T00:00:00Z`))

  const chips: Array<{ key: Filter; label: string; count: number }> = [
    { key: 'all', label: strings.filterAll, count: obligations.length },
    ...ORDER.map((s) => ({ key: s as Filter, label: strings.status[s], count: counts[s] })),
  ]

  return (
    <div>
      <FadeIn>
        <div className="flex flex-wrap gap-2">
          {chips.map((chip) => {
            const active = filter === chip.key
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() => setFilter(chip.key)}
                aria-pressed={active}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium',
                  'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]',
                  active
                    ? 'border-transparent bg-ink text-surface-2'
                    : 'border-edge text-ink-dim hover:bg-surface-2 hover:text-ink',
                )}
              >
                {chip.label}
                <span className="tabular-nums opacity-70">{chip.count}</span>
              </button>
            )
          })}
        </div>
      </FadeIn>

      {shown.length === 0 ? (
        <Card className="mt-6">
          <p className="text-sm text-ink-dim">{strings.noMatches}</p>
        </Card>
      ) : (
        <StaggerList key={filter} className="mt-6 flex flex-col gap-2">
          {shown.map((o, i) => (
            <StaggerItem key={`${o.contractId}-${i}`}>
              <Link
                href={o.clauseId ? `/contracts/${o.contractId}#clause-${o.clauseId}` : `/contracts/${o.contractId}`}
                className="block rounded-lg border border-edge bg-surface p-3.5 transition-colors hover:bg-surface-2"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span dir="auto" className="text-sm font-medium text-ink">
                    {roleLabel(o, strings).label}
                  </span>
                  <span className={cn('text-[11px] font-medium', STATUS_TONE[o.resolution.status])}>
                    {o.resolution.status === 'resolved' && o.resolution.date
                      ? dateFormat.format(new Date(`${o.resolution.date}T00:00:00Z`))
                      : o.resolution.reason
                        ? strings.reason[o.resolution.reason]
                        : strings.noDeadline}
                  </span>
                </div>

                <p dir="auto" className="mt-1 text-sm leading-relaxed text-ink-dim">
                  {o.action}
                </p>

                {/* The document's own word for who owes this, kept whenever it
                    differs from the normalized label above. */}
                {roleLabel(o, strings).original && (
                  <p dir="auto" className="mt-1 text-[11px] text-ink-faint">
                    {strings.obligorAs} “{roleLabel(o, strings).original}”
                  </p>
                )}

                {/* The document's own words for the timing, always shown --
                    it is the fact, where the resolved date is a derivation
                    from it. */}
                {o.due && (
                  <p dir="auto" className="mt-1.5 text-[11px] text-ink-faint">
                    {strings.statedAs} “{o.due}”
                  </p>
                )}

                {o.resolution.derivation && (
                  <p dir="auto" className="mt-1 text-[11px] text-ink-faint">
                    {strings.derivedFrom} {formatDerivation(o.resolution.derivation, strings, formatDate)}
                  </p>
                )}

                <p dir="auto" className="mt-1.5 text-[11px] text-ink-faint">
                  {o.contractTitle}
                </p>
              </Link>
            </StaggerItem>
          ))}
        </StaggerList>
      )}
    </div>
  )
}
