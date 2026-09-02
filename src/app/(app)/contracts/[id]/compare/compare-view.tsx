'use client'
import { useMemo, useState } from 'react'
import { Minus, Plus, PencilLine, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { RiskPill } from '@/components/ui/risk-pill'
import { cn } from '@/components/ui/cn'
import { diffWords } from '@/lib/revision/words'
import type { RiskDelta, Severity } from '@/lib/revision/risk-delta'

/**
 * One clause change, with every label already resolved.
 *
 * The alignment produces clause records; this view needs sentences. Resolving
 * them on the server keeps the pure comparison module free of i18n and this
 * component free of message keys -- and it is the only shape that can cross
 * the server/client boundary at all, since a `t()` closure cannot.
 */
export interface ChangeItem {
  key: string
  kind: 'unchanged' | 'modified' | 'added' | 'removed'
  title: string
  /** "was clause 8", when the revision renumbered it. */
  renumberedFrom: string | null
  dir: 'rtl' | 'ltr'
  /** The text as it stands now -- or, for a removed clause, as it stood. */
  body: string
  /** Set only on a modified clause: the two readings the diff runs over. */
  before?: string
  after?: string
}

export interface CompareStrings {
  summary: { unchanged: string; modified: string; added: string; removed: string }
  identical: string
  changeLabel: { unchanged: string; modified: string; added: string; removed: string }
  changesTitle: string
  showUnchanged: string
  hideUnchanged: string
  risk: {
    title: string
    introduced: string
    noLongerReported: string
    noLongerReportedHint: string
    carried: string
    worse: string
    better: string
    unchangedProfile: string
    notAnalyzed: string
  }
}

/** The redline itself: one paragraph carrying both readings, struck text for
    what the revision took out and marked text for what it put in. Preferred
    over two columns because a contract clause is long, and a reader comparing
    two columns has to hold a sentence in their head to do it. */
function ClauseDiff({ before, after, dir }: { before: string; after: string; dir: 'rtl' | 'ltr' }) {
  const segments = useMemo(() => diffWords(before, after), [before, after])
  return (
    <p dir={dir} className="text-sm leading-relaxed text-ink-dim">
      {segments.map((segment, i) => (
        <span
          key={i}
          className={cn(
            segment.kind === 'removed' && 'rounded bg-risk-high/10 text-risk-high line-through decoration-risk-high/60',
            segment.kind === 'added' && 'rounded bg-accent/10 font-medium text-accent',
          )}
        >
          {segment.text}{' '}
        </span>
      ))}
    </p>
  )
}

const TONE = {
  unchanged: '',
  modified: 'border-s-2 border-s-brass',
  added: 'border-s-2 border-s-accent',
  removed: 'border-s-2 border-s-risk-high',
} as const

const LABEL_TONE = {
  unchanged: 'bg-surface-3 text-ink-dim',
  modified: 'bg-surface-3 text-brass',
  added: 'bg-surface-3 text-accent',
  removed: 'bg-surface-3 text-risk-high',
} as const

const ICON = { unchanged: null, modified: PencilLine, added: Plus, removed: Minus } as const

function ChangeCard({ item, strings }: { item: ChangeItem; strings: CompareStrings }) {
  const Icon = ICON[item.kind]
  return (
    <Card className={cn('py-4', TONE[item.kind])}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-serif text-sm font-medium text-brass">{item.title}</span>
        {item.kind !== 'unchanged' && (
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', LABEL_TONE[item.kind])}>
            {Icon && <Icon size={12} aria-hidden="true" />}
            {strings.changeLabel[item.kind]}
          </span>
        )}
        {/* A clause that kept its text but changed its number is not an
            amendment, and saying nothing about the renumbering would leave a
            reader hunting for "clause 7" in a document that no longer has
            one. */}
        {item.renumberedFrom && <span className="text-xs text-ink-faint">{item.renumberedFrom}</span>}
      </div>

      {item.kind === 'modified' && item.before !== undefined && item.after !== undefined ? (
        <ClauseDiff before={item.before} after={item.after} dir={item.dir} />
      ) : (
        <p
          dir={item.dir}
          className={cn('text-sm leading-relaxed', item.kind === 'removed' ? 'text-ink-faint line-through' : 'text-ink-dim')}
        >
          {item.body}
        </p>
      )}
    </Card>
  )
}

function FindingRow({ finding, trailing }: {
  finding: { title: string; severity: Severity }
  trailing?: React.ReactNode
}) {
  return (
    <li className="flex items-start justify-between gap-3 border-b border-edge py-2 last:border-b-0">
      <span className="text-sm text-ink-dim">{finding.title}</span>
      <span className="flex shrink-0 items-center gap-2">
        {trailing}
        <RiskPill level={finding.severity} />
      </span>
    </li>
  )
}

export function CompareView({
  items,
  counts,
  identical,
  delta,
  strings,
}: {
  items: ChangeItem[]
  counts: { unchanged: number; modified: number; added: number; removed: number }
  identical: boolean
  /** null when either version has no analysis: the risk profile is then
      genuinely unknown, which is a different statement from "no findings". */
  delta: RiskDelta | null
  strings: CompareStrings
}) {
  const [showUnchanged, setShowUnchanged] = useState(false)
  const visible = showUnchanged ? items : items.filter((c) => c.kind !== 'unchanged')

  const SUMMARY = [
    { key: 'modified', value: counts.modified, tone: 'text-brass' },
    { key: 'added', value: counts.added, tone: 'text-accent' },
    { key: 'removed', value: counts.removed, tone: 'text-risk-high' },
    { key: 'unchanged', value: counts.unchanged, tone: 'text-ink-dim' },
  ] as const

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {SUMMARY.map((stat) => (
          <Card key={stat.key} className="p-4">
            <p className={cn('font-serif text-2xl font-medium tabular-nums', stat.tone)}>{stat.value}</p>
            <p className="text-xs text-ink-faint">{strings.summary[stat.key]}</p>
          </Card>
        ))}
      </div>

      <section aria-labelledby="risk-delta-heading">
        <h2 id="risk-delta-heading" className="mb-3 font-serif text-lg font-medium text-ink">
          {strings.risk.title}
        </h2>
        {!delta ? (
          <Card><p className="text-sm text-ink-dim">{strings.risk.notAnalyzed}</p></Card>
        ) : delta.unchanged && !delta.introduced.length && !delta.noLongerReported.length ? (
          <Card><p className="text-sm text-ink-dim">{strings.risk.unchangedProfile}</p></Card>
        ) : (
          <div className="flex flex-col gap-4">
            {!!delta.introduced.length && (
              <Card>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-risk-high">
                  <Plus size={14} aria-hidden="true" />
                  {strings.risk.introduced}
                </h3>
                <ul>
                  {delta.introduced.map((f) => (
                    <FindingRow key={f.id} finding={f} />
                  ))}
                </ul>
              </Card>
            )}

            {!!delta.noLongerReported.length && (
              <Card>
                <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-accent">
                  <Minus size={14} aria-hidden="true" />
                  {strings.risk.noLongerReported}
                </h3>
                {/* The one place this page could overclaim. A finding that
                    stopped appearing is an observation about the analysis,
                    not a confirmation that the risk was negotiated away. */}
                <p className="mb-2 text-xs text-ink-faint">{strings.risk.noLongerReportedHint}</p>
                <ul>
                  {delta.noLongerReported.map((f) => (
                    <FindingRow key={f.id} finding={f} />
                  ))}
                </ul>
              </Card>
            )}

            {!!delta.carried.length && (
              <Card>
                <h3 className="mb-2 text-sm font-semibold text-ink-dim">{strings.risk.carried}</h3>
                <ul>
                  {delta.carried.map((c) => (
                    <FindingRow
                      key={c.revised.id}
                      finding={c.revised}
                      trailing={
                        c.severityChange === 'same' ? null : (
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 text-xs font-semibold',
                              c.severityChange === 'worse' ? 'text-risk-high' : 'text-accent',
                            )}
                          >
                            {c.severityChange === 'worse' ? (
                              <ArrowUpRight size={12} aria-hidden="true" className="rtl:-scale-x-100" />
                            ) : (
                              <ArrowDownRight size={12} aria-hidden="true" className="rtl:-scale-x-100" />
                            )}
                            {c.severityChange === 'worse' ? strings.risk.worse : strings.risk.better}
                          </span>
                        )
                      }
                    />
                  ))}
                </ul>
              </Card>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="clause-changes-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="clause-changes-heading" className="font-serif text-lg font-medium text-ink">
            {strings.changesTitle}
          </h2>
          {counts.unchanged > 0 && (
            <button
              type="button"
              onClick={() => setShowUnchanged((v) => !v)}
              aria-pressed={showUnchanged}
              className="text-sm text-accent hover:underline"
            >
              {showUnchanged ? strings.hideUnchanged : strings.showUnchanged}
            </button>
          )}
        </div>

        {identical ? (
          <Card><p className="text-sm text-ink-dim">{strings.identical}</p></Card>
        ) : (
          <div className="flex flex-col gap-3">
            {visible.map((item) => (
              <ChangeCard key={item.key} item={item} strings={strings} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
