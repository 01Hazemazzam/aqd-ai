'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Sparkles,
  ClipboardList,
  TriangleAlert,
  MessageSquare,
  ChevronDown,
  CornerDownRight,
  Users,
  CalendarDays,
  Clock,
  Scale,
  Wallet,
} from 'lucide-react'
import { RiskPill } from '@/components/ui/risk-pill'
import { cn } from '@/components/ui/cn'
import { focusClause } from '@/lib/clause/focus'
import { ContractChat } from './chat-panel'
import type { ContractChatMessage } from './chat-panel'

// The analysis rail: everything the analysis produced, plus contract chat,
// behind one tab strip beside the document.
//
// It exists because the reader used to stack analysis cards, then every
// clause, then chat -- which put the chat input ~5,000px down a 23-clause
// contract and split risk across two unrelated places (an inline clause
// gutter, and an "other findings" card far above). Here the risk findings are
// one scannable list, each row expands to quote its own clause inline, and
// chat is always one tab away instead of a scroll away.
//
// Sticky only from `lg` up. Below that the rail stacks ABOVE the document, so
// small screens still lead with the analysis rather than making the reader
// scroll the whole contract to find it.

export type Severity = 'high' | 'medium' | 'low'

export interface RailClause {
  id: string
  ordinal: number
  clauseNumber: string | null
  lang: string | null
  body: string
}

export type FindingKind = 'playbook' | 'asymmetry' | 'contradiction' | 'dependency'

export interface RailEvidence {
  clauseId: string
  /** Verbatim words from that clause, verified at analysis time. */
  quote: string
}

export interface RailFinding {
  id: string
  /** The clause the finding is anchored to (the first quoted one). */
  clauseId: string | null
  kind: FindingKind
  severity: Severity
  title: string
  reason: string
  /** One entry per clause quoted -- two or more for a finding about how
      clauses relate. Empty for a missing-clause finding, and for findings
      produced before evidence was captured. */
  evidence: RailEvidence[]
}

type Tab = 'risks' | 'summary' | 'obligations' | 'chat'

const FIELD_ICON = {
  parties: Users,
  effectiveDate: CalendarDays,
  termLength: Clock,
  governingLaw: Scale,
  totalValue: Wallet,
} as const

export function AnalysisRail({
  contractId,
  clauses,
  findings,
  summary,
  fields,
  obligations,
  initialMessages,
}: {
  contractId: string
  clauses: RailClause[]
  findings: RailFinding[]
  summary: string | null
  fields: Record<string, string | string[] | null> | null
  obligations: Array<{ obligor: string; action: string; due: string | null }>
  initialMessages: ContractChatMessage[]
}) {
  const t = useTranslations('contracts')
  // Open on whatever this contract actually has: risk first when there is
  // any, then the summary, else straight to chat on an unanalyzed contract.
  const [tab, setTab] = useState<Tab>(findings.length > 0 ? 'risks' : summary ? 'summary' : 'chat')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const clauseById = new Map(clauses.map((c) => [c.id, c]))

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const TABS: Array<{ key: Tab; label: string; icon: typeof Sparkles; count?: number }> = [
    { key: 'risks', label: t('reader.tabs.risks'), icon: TriangleAlert, count: findings.length },
    { key: 'summary', label: t('reader.tabs.summary'), icon: Sparkles },
    { key: 'obligations', label: t('reader.tabs.obligations'), icon: ClipboardList, count: obligations.length },
    { key: 'chat', label: t('reader.tabs.chat'), icon: MessageSquare },
  ]

  return (
    <aside className="lg:sticky lg:top-24 lg:order-2 lg:self-start">
      <div className="overflow-hidden rounded-xl border border-edge bg-surface-2 shadow-sm">
        <div role="tablist" aria-label={t('reader.tabsLabel')} className="flex border-b border-edge">
          {TABS.map((def) => {
            const Icon = def.icon
            const active = tab === def.key
            return (
              <button
                key={def.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(def.key)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 px-2 py-3 text-xs font-semibold',
                  'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]',
                  active ? 'bg-surface-3 text-ink' : 'text-ink-faint hover:bg-surface-3 hover:text-ink-dim',
                )}
              >
                <Icon size={14} aria-hidden="true" />
                <span className="sr-only">{def.label}</span>
                {typeof def.count === 'number' && def.count > 0 && (
                  <span aria-hidden="true" className="tabular-nums">{def.count}</span>
                )}
              </button>
            )
          })}
        </div>

        <div className="p-4 lg:max-h-[calc(100vh-13rem)] lg:overflow-y-auto">
          {tab === 'risks' && (
            <ul className="flex flex-col gap-2.5">
              {findings.length === 0 && <li className="text-sm text-ink-faint">{t('reader.noFindings')}</li>}
              {findings.map((f) => {
                const clause = f.clauseId ? clauseById.get(f.clauseId) : undefined
                const isOpen = expanded.has(f.id)
                // Only spans pointing at a clause still in the document can
                // be shown or jumped to.
                const spans = f.evidence.filter((e) => clauseById.has(e.clauseId))
                // A cross-clause finding names every clause it spans, so the
                // collapsed row already tells the reader it is about a
                // relationship rather than a single clause.
                const clauseLabels = [...new Set(spans.map((s) => s.clauseId))]
                  .map((id) => clauseById.get(id))
                  .filter((c) => c !== undefined)
                  .map((c) => t('clauseHeading', { number: c.clauseNumber ?? String(c.ordinal) }))
                return (
                  <li key={f.id} className="overflow-hidden rounded-lg border border-edge bg-surface">
                    <button
                      type="button"
                      onClick={() => toggle(f.id)}
                      aria-expanded={isOpen}
                      className="flex w-full items-start gap-2 p-3 text-start transition-colors hover:bg-surface-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <span dir="auto" className="text-sm font-medium text-ink">{f.title}</span>
                          <RiskPill level={f.severity} />
                        </div>
                        <p dir="auto" className="mt-1 text-xs leading-relaxed text-ink-dim">{f.reason}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-faint">
                          {f.kind !== 'playbook' && (
                            <span className="rounded-full border border-edge px-1.5 py-px font-medium text-ink-dim">
                              {t(`reader.kinds.${f.kind}` as 'reader.kinds.asymmetry')}
                            </span>
                          )}
                          <span>
                            {clauseLabels.length > 0
                              ? clauseLabels.join(' · ')
                              : clause
                                ? t('clauseHeading', { number: clause.clauseNumber ?? String(clause.ordinal) })
                                : t('reader.clauseNotPresent')}
                          </span>
                        </div>
                      </div>
                      <ChevronDown
                        size={15}
                        aria-hidden="true"
                        className={cn('mt-0.5 shrink-0 text-ink-faint transition-transform', isOpen && 'rotate-180')}
                      />
                    </button>

                    {isOpen && (
                      <div className="border-t border-edge bg-surface-2 p-3">
                        {spans.length > 0 ? (
                          <>
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                              {t('reader.evidence')}
                            </p>
                            {/* One quote per clause the finding rests on. A
                                cross-clause finding has two or more, and
                                showing them stacked IS the argument: the
                                reader sees both sides of the asymmetry or
                                contradiction without leaving the rail. */}
                            <ul className="flex flex-col gap-3">
                              {spans.map((span, i) => {
                                const quoted = clauseById.get(span.clauseId)
                                return (
                                  <li key={`${span.clauseId}-${i}`}>
                                    {quoted && (
                                      <p className="mb-1 text-[11px] text-ink-faint">
                                        {t('clauseHeading', {
                                          number: quoted.clauseNumber ?? String(quoted.ordinal),
                                        })}
                                      </p>
                                    )}
                                    <p
                                      dir={quoted?.lang === 'ar' ? 'rtl' : 'ltr'}
                                      className="border-s-2 border-brass ps-2.5 text-xs italic leading-relaxed text-ink-dim"
                                    >
                                      {span.quote}
                                    </p>
                                    <button
                                      type="button"
                                      onClick={() => focusClause(span.clauseId)}
                                      className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline"
                                    >
                                      <CornerDownRight size={13} aria-hidden="true" className="rtl:-scale-x-100" />
                                      {t('reader.jumpToClause')}
                                    </button>
                                  </li>
                                )
                              })}
                            </ul>
                          </>
                        ) : clause ? (
                          <>
                            {/* No spans but an anchored clause: a finding
                                analysed before evidence was captured. The
                                whole clause is the honest fallback -- it is
                                where the finding came from, just not narrowed
                                to the words. */}
                            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                              {t('reader.evidence')}
                            </p>
                            <p dir={clause.lang === 'ar' ? 'rtl' : 'ltr'} className="text-xs leading-relaxed text-ink-dim">
                              {clause.body}
                            </p>
                            <button
                              type="button"
                              onClick={() => focusClause(clause.id)}
                              className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline"
                            >
                              <CornerDownRight size={13} aria-hidden="true" className="rtl:-scale-x-100" />
                              {t('reader.jumpToClause')}
                            </button>
                          </>
                        ) : (
                          <p className="text-xs leading-relaxed text-ink-faint">{t('reader.clauseNotPresentHint')}</p>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {tab === 'summary' && (
            <div className="flex flex-col gap-4">
              <p dir="auto" className="text-sm leading-relaxed text-ink-dim">{summary ?? '—'}</p>
              {fields && (
                <dl className="flex flex-col gap-3 border-t border-edge pt-4 text-sm">
                  {Object.entries(fields).map(([key, value]) => {
                    const Icon = FIELD_ICON[key as keyof typeof FIELD_ICON]
                    return (
                      <div key={key} className="flex items-start gap-2.5">
                        {Icon && <Icon size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-faint" />}
                        <div className="min-w-0">
                          <dt className="text-xs text-ink-faint">
                            {t(`fieldLabels.${key}` as 'fieldLabels.parties')}
                          </dt>
                          <dd dir="auto" className="break-words text-ink-dim">
                            {Array.isArray(value) ? value.join(', ') || '—' : value ?? '—'}
                          </dd>
                        </div>
                      </div>
                    )
                  })}
                </dl>
              )}
            </div>
          )}

          {tab === 'obligations' && (
            <ul className="flex flex-col gap-2.5 text-sm">
              {obligations.length === 0 && <li className="text-ink-faint">{t('reader.noObligations')}</li>}
              {obligations.map((o, i) => (
                <li key={i} dir="auto" className="border-b border-edge pb-2.5 text-ink-dim last:border-b-0 last:pb-0">
                  <span className="font-medium text-ink">{o.obligor}</span>: {o.action}
                  {o.due && <span className="mt-0.5 block text-xs text-ink-faint">{o.due}</span>}
                </li>
              ))}
            </ul>
          )}

          {tab === 'chat' && <ContractChat contractId={contractId} initialMessages={initialMessages} />}
        </div>
      </div>
    </aside>
  )
}
