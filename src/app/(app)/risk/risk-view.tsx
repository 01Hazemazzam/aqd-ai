'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ShieldCheck, ChevronRight, FileQuestion } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { RiskPill } from '@/components/ui/risk-pill'
import { FadeIn, StaggerList, StaggerItem } from '@/components/ui/reveal'
import { cn } from '@/components/ui/cn'
import type { RiskPortfolio, Severity } from '@/lib/risk/portfolio'

// Resolved (already-translated) strings, so this view carries no assumption
// about the i18n key layout -- the same "text in, UI out" shape the obligations
// view and the chat widget use. Keeps it previewable and testable without a
// next-intl provider.
export interface RiskStrings {
  title: string
  subtitle: string
  empty: string
  emptyDescription: string
  totalFindings: string
  contractsAffected: string
  filterAll: string
  noMatches: string
  missingClause: string
  /** ICU-style template containing `{number}`, e.g. "Clause {number}". Kept a
      plain string, not a formatter function: this view is a Client Component
      and a server page cannot pass functions across that boundary. */
  clauseLabel: string
  severity: Record<Severity, string>
}

const SEVERITY_COLOR: Record<Severity, string> = {
  high: 'var(--risk-high)',
  medium: 'var(--risk-medium)',
  low: 'var(--risk-low)',
}

const ORDER: Severity[] = ['high', 'medium', 'low']

type Filter = Severity | 'all'

export function RiskView({ portfolio, strings }: { portfolio: RiskPortfolio; strings: RiskStrings }) {
  const [filter, setFilter] = useState<Filter>('all')

  if (portfolio.total === 0) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-20 sm:px-10">
        <FadeIn>
          <h1 className="text-balance font-serif text-3xl font-medium tracking-tight text-ink">{strings.title}</h1>
          <p className="mt-2 text-sm text-ink-dim">{strings.subtitle}</p>
        </FadeIn>
        <Card className="mt-8">
          <EmptyState
            icon={<ShieldCheck size={22} aria-hidden="true" />}
            title={strings.empty}
            description={strings.emptyDescription}
          />
        </Card>
      </main>
    )
  }

  // Filtering narrows the findings inside each contract; a contract with
  // nothing left at this severity drops out of the list entirely rather than
  // rendering an empty shell.
  const contracts = portfolio.contracts
    .map((c) => ({ ...c, findings: filter === 'all' ? c.findings : c.findings.filter((f) => f.severity === filter) }))
    .filter((c) => c.findings.length > 0)

  const chips: Array<{ key: Filter; label: string; count: number; color?: string }> = [
    { key: 'all', label: strings.filterAll, count: portfolio.total },
    ...ORDER.map((s) => ({ key: s, label: strings.severity[s], count: portfolio.counts[s], color: SEVERITY_COLOR[s] })),
  ]

  return (
    <main className="mx-auto max-w-3xl px-6 py-20 sm:px-10">
      <FadeIn>
        <h1 className="text-balance font-serif text-3xl font-medium tracking-tight text-ink">{strings.title}</h1>
        <p className="mt-2 text-sm text-ink-dim">{strings.subtitle}</p>
      </FadeIn>

      <FadeIn delay={0.06}>
        <Card className="mt-8">
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
            <div>
              <p className="font-serif text-4xl font-medium tabular-nums leading-none text-ink">{portfolio.total}</p>
              <p className="mt-1.5 text-xs text-ink-faint">{strings.totalFindings}</p>
            </div>
            <div>
              <p className="font-serif text-4xl font-medium tabular-nums leading-none text-ink">
                {portfolio.contractsAffected}
              </p>
              <p className="mt-1.5 text-xs text-ink-faint">{strings.contractsAffected}</p>
            </div>
          </div>

          {/* Severity breakdown: one bar, segments proportional to each
              severity's share, so the portfolio's shape reads at a glance
              before any number is parsed. */}
          <div className="mt-6 flex h-2 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
            {ORDER.map((s) =>
              portfolio.counts[s] > 0 ? (
                <span
                  key={s}
                  className="h-full"
                  style={{
                    width: `${(portfolio.counts[s] / portfolio.total) * 100}%`,
                    backgroundColor: SEVERITY_COLOR[s],
                  }}
                />
              ) : null,
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
            {ORDER.map((s) => (
              <div key={s} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: SEVERITY_COLOR[s] }}
                />
                <span className="text-xs text-ink-dim">
                  <span className="font-semibold tabular-nums text-ink">{portfolio.counts[s]}</span> {strings.severity[s]}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </FadeIn>

      <FadeIn delay={0.12}>
        <div className="mt-6 flex flex-wrap gap-2">
          {chips.map((chip) => {
            const active = filter === chip.key
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() => setFilter(chip.key)}
                aria-pressed={active}
                disabled={chip.count === 0}
                className={cn(
                  'inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold',
                  'transition-[background-color,border-color,color] duration-[var(--duration-fast)] ease-[var(--ease-out)]',
                  'disabled:pointer-events-none disabled:opacity-40',
                  active
                    ? 'border-transparent bg-ink text-surface-2'
                    : 'border-edge bg-surface-2 text-ink-dim hover:bg-surface-3 hover:text-ink',
                )}
              >
                {chip.color && !active && (
                  <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: chip.color }} />
                )}
                {chip.label}
                <span className="tabular-nums opacity-70">{chip.count}</span>
              </button>
            )
          })}
        </div>
      </FadeIn>

      {contracts.length === 0 && (
        <Card className="mt-6">
          <EmptyState icon={<FileQuestion size={22} aria-hidden="true" />} title={strings.noMatches} />
        </Card>
      )}

      {/* Keyed by filter so switching severities replays the stagger --
          the list visibly re-forms instead of silently swapping rows. */}
      <StaggerList key={filter} className="mt-6 flex flex-col gap-4">
        {contracts.map((contract) => (
          <StaggerItem key={contract.contractId}>
            <Card className="p-0">
              <div className="flex items-center justify-between gap-3 border-b border-edge px-5 py-3.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="h-6 w-1 shrink-0 rounded-full"
                    style={{ backgroundColor: SEVERITY_COLOR[contract.topSeverity] }}
                  />
                  <Link
                    href={`/contracts/${contract.contractId}`}
                    dir="auto"
                    className="truncate text-sm font-semibold text-ink hover:underline"
                  >
                    {contract.contractTitle}
                  </Link>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {ORDER.map((s) =>
                    contract.counts[s] > 0 ? (
                      <span
                        key={s}
                        title={strings.severity[s]}
                        className="rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
                        style={{
                          color: SEVERITY_COLOR[s],
                          backgroundColor: `color-mix(in oklch, ${SEVERITY_COLOR[s]} 12%, var(--surface-2))`,
                        }}
                      >
                        <span className="sr-only">{strings.severity[s]}: </span>
                        {contract.counts[s]}
                      </span>
                    ) : null,
                  )}
                </div>
              </div>

              <ul className="flex flex-col">
                {contract.findings.map((f) => (
                  <li key={f.id} className="border-b border-edge last:border-b-0">
                    {/* Drill-down: to the exact clause when the finding is
                        anchored to one, to the contract when the finding is
                        about a clause the document is MISSING. */}
                    <Link
                      href={
                        f.clauseId ? `/contracts/${f.contractId}#clause-${f.clauseId}` : `/contracts/${f.contractId}`
                      }
                      className={cn(
                        'flex items-start gap-3 px-5 py-4',
                        'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-surface-3',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          <span dir="auto" className="text-sm font-medium text-ink">
                            {f.title}
                          </span>
                          <span className="text-xs text-ink-faint">
                            {f.clauseNumber
                              ? strings.clauseLabel.replace('{number}', f.clauseNumber)
                              : strings.missingClause}
                          </span>
                        </div>
                        <p dir="auto" className="mt-1 text-sm leading-relaxed text-ink-dim">
                          {f.reason}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 pt-0.5">
                        <RiskPill level={f.severity} />
                        <ChevronRight size={16} aria-hidden="true" className="text-ink-faint rtl:-scale-x-100" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </StaggerItem>
        ))}
      </StaggerList>
    </main>
  )
}
