import Link from 'next/link'
import { ChevronRight, ShieldCheck, CircleAlert } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { RiskPill } from '@/components/ui/risk-pill'
import { FadeIn, StaggerList, StaggerItem } from '@/components/ui/reveal'
import { cn } from '@/components/ui/cn'
import type { AttentionTier, Intelligence, Severity } from '@/lib/intelligence/build'
import type { PartyRole } from '@/lib/intelligence/party-role'

// "What needs attention" -- the question an operator opens this section to
// ask. Two halves: contracts ranked by tier, and the individual clauses where
// a risk finding and an obligation land on the same clause.
//
// An attention item is the primitive: a duty someone must perform that the
// analysis also flagged. That coincidence is what makes it actionable rather
// than merely listed, and it is a real join -- both sides point at the same
// clause id -- not a correlation inferred across the portfolio.

export interface AttentionStrings {
  empty: string
  emptyDescription: string
  summaryAttention: string
  summaryOverdue: string
  summarySoon: string
  contractsTitle: string
  itemsTitle: string
  noItems: string
  nextLabel: string
  noDeadline: string
  outdatedTag: string
  /** ICU-style template containing `{number}`. */
  clauseLabel: string
  tier: Record<AttentionTier, string>
  severity: Record<Severity, string>
  role: Record<PartyRole, string>
  /** Contract id -> its own party names, for showing party_a as a real name. */
  partyNames: Record<string, string[]>
}

// Tiers that mean "act now" are marked; the rest read as ordinary rows, so
// the colour carries information instead of decorating every line.
const TIER_TONE: Record<AttentionTier, string> = {
  overdue_high_risk: 'text-risk-high',
  due_soon_high_risk: 'text-risk-high',
  overdue: 'text-risk-medium',
  due_soon: 'text-risk-medium',
  high_risk_undated: 'text-ink-dim',
  monitored: 'text-ink-faint',
}

function roleLabel(
  role: PartyRole | null,
  obligor: string,
  contractId: string,
  strings: AttentionStrings,
): string {
  if (role === null) return obligor
  if (role === 'both' || role === 'third_party') return strings.role[role]
  const names = strings.partyNames[contractId] ?? []
  const name = role === 'party_a' ? names[0] : names[1]
  // The verbatim obligor is the fallback and the real name is preferred --
  // the role is a grouping key, never a replacement for what the clause said.
  return name || obligor
}

export function AttentionView({
  intelligence,
  locale,
  strings,
}: {
  intelligence: Intelligence
  locale: string
  strings: AttentionStrings
}) {
  const { contracts, attention, counts } = intelligence

  if (contracts.length === 0) {
    return (
      <Card>
        <EmptyState icon={<ShieldCheck size={22} aria-hidden="true" />} title={strings.empty} description={strings.emptyDescription} />
      </Card>
    )
  }

  const dateFormat = new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const formatDate = (iso: string) => dateFormat.format(new Date(`${iso}T00:00:00Z`))

  return (
    <div className="flex flex-col gap-8">
      <FadeIn>
        <Card>
          <div className="flex flex-wrap items-baseline gap-x-10 gap-y-4">
            {[
              { value: counts.attention, label: strings.summaryAttention },
              { value: counts.overdue, label: strings.summaryOverdue },
              { value: counts.soon, label: strings.summarySoon },
            ].map((stat) => (
              <div key={stat.label}>
                <p className="font-serif text-4xl font-medium tabular-nums leading-none text-ink">{stat.value}</p>
                <p className="mt-1.5 text-xs text-ink-faint">{stat.label}</p>
              </div>
            ))}
          </div>
        </Card>
      </FadeIn>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink">{strings.contractsTitle}</h2>
        <StaggerList className="flex flex-col gap-2">
          {contracts.map((c) => (
            <StaggerItem key={c.contractId}>
              <Link
                href={`/contracts/${c.contractId}`}
                className="flex items-center gap-3 rounded-lg border border-edge bg-surface p-3.5 transition-colors hover:bg-surface-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span dir="auto" className="truncate text-sm font-medium text-ink">
                      {c.title}
                    </span>
                    {!c.current && (
                      <span className="rounded-full border border-edge px-1.5 py-px text-[11px] text-ink-faint">
                        {strings.outdatedTag}
                      </span>
                    )}
                  </div>
                  <p className={cn('mt-1 text-xs', TIER_TONE[c.tier])}>{strings.tier[c.tier]}</p>
                </div>
                {c.nextDate && (
                  <div className="shrink-0 text-end">
                    <p className="text-xs text-ink-faint">{strings.nextLabel}</p>
                    <p className="text-sm tabular-nums text-ink-dim">{formatDate(c.nextDate)}</p>
                  </div>
                )}
                <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-faint rtl:rotate-180" />
              </Link>
            </StaggerItem>
          ))}
        </StaggerList>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink">{strings.itemsTitle}</h2>
        {attention.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-dim">{strings.noItems}</p>
          </Card>
        ) : (
          <StaggerList className="flex flex-col gap-2">
            {attention.map((item, i) => (
              <StaggerItem key={`${item.contractId}-${item.clauseId}-${i}`}>
                <Link
                  href={`/contracts/${item.contractId}#clause-${item.clauseId}`}
                  className="block rounded-lg border border-edge bg-surface p-3.5 transition-colors hover:bg-surface-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p dir="auto" className="text-sm font-medium text-ink">
                        {item.action}
                      </p>
                      <p dir="auto" className="mt-0.5 text-xs text-ink-dim">
                        {roleLabel(item.role, item.obligor, item.contractId, strings)}
                      </p>
                    </div>
                    <RiskPill level={item.severity} />
                  </div>

                  {/* The risk half of the pairing: why this duty is worth
                      looking at, not just that it exists. */}
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-dim">
                    <CircleAlert size={13} aria-hidden="true" className="shrink-0 text-risk-medium" />
                    <span dir="auto">{item.findingTitle}</span>
                  </p>

                  <p className="mt-2 text-[11px] text-ink-faint">
                    <span dir="auto">{item.contractTitle}</span>
                    {' · '}
                    {item.resolution.date ? formatDate(item.resolution.date) : (item.due ?? strings.noDeadline)}
                  </p>
                </Link>
              </StaggerItem>
            ))}
          </StaggerList>
        )}
      </section>
    </div>
  )
}
