import { getLocale, getTranslations } from 'next-intl/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/org/current'
import { loadIntelligence } from '@/lib/intelligence/load'
import { supabaseIntelligenceReader } from '@/lib/intelligence/supabase-reader'
import { buildRiskPortfolio, type RawFinding } from '@/lib/risk/portfolio'
import { IntelligenceShell } from './intelligence-shell'
import { AttentionView } from './attention-view'
import { CalendarView } from './calendar-view'
import { ObligationsView } from './obligations-view'
import { AskView } from './ask-view'
import { loadPortfolioHistory } from '@/lib/chat/portfolio-history'
import { RiskView } from '../risk/risk-view'

export type View = 'attention' | 'calendar' | 'obligations' | 'risk' | 'ask'

const VIEWS: readonly View[] = ['attention', 'calendar', 'obligations', 'risk', 'ask']

export default async function IntelligencePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const { view: requested } = await searchParams
  const view: View = VIEWS.includes(requested as View) ? (requested as View) : 'attention'

  const t = await getTranslations('intelligence')
  const tr = await getTranslations('risk')
  const locale = await getLocale()
  const orgId = await getCurrentOrgId()
  const supabase = await createServerSupabase()

  // The page and the Intelligence assistant read through the same loader, so
  // the Attention view and an answer about which contracts need attention
  // cannot disagree.
  const { intelligence, findings, partyNames } = await loadIntelligence(supabaseIntelligenceReader(supabase), orgId, new Date())

  // The risk view is reused unchanged, so it still takes the portfolio shape
  // it was built for -- absorbing a page into a section should not mean
  // rewriting what already worked. Locale resolution happens here rather than
  // in the loader: a pure module has no business knowing the reader's
  // language.
  const riskRows: RawFinding[] = findings.map((f) => ({
    id: f.id,
    contractId: f.contractId,
    contractTitle: f.contractTitle,
    clauseId: f.clauseId,
    clauseNumber: null,
    severity: f.severity,
    title: f.title,
    reason: locale === 'ar' ? (f.reasonAr ?? f.reason) : f.reason,
    ruleKey: f.ruleKey,
  }))

  const askHistory = view === 'ask' ? await loadPortfolioHistory(supabase, t('ask.notFound')) : []

  const shellStrings = {
    title: t('title'),
    subtitle: t('subtitle'),
    views: {
      attention: t('views.attention'),
      calendar: t('views.calendar'),
      obligations: t('views.obligations'),
      risk: t('views.risk'),
      ask: t('views.ask'),
    },
    outdatedNotice: t.raw('outdatedNotice') as string,
  }

  return (
    <IntelligenceShell view={view} strings={shellStrings} outdated={intelligence.counts.outdated}>
      {view === 'attention' && (
        <AttentionView
          intelligence={intelligence}
          locale={locale}
          strings={{
            empty: t('attention.empty'),
            emptyDescription: t('attention.emptyDescription'),
            summaryAttention: t('attention.summaryAttention'),
            summaryOverdue: t('attention.summaryOverdue'),
            summarySoon: t('attention.summarySoon'),
            contractsTitle: t('attention.contractsTitle'),
            itemsTitle: t('attention.itemsTitle'),
            noItems: t('attention.noItems'),
            nextLabel: t('attention.nextLabel'),
            noDeadline: t('noDeadline'),
            outdatedTag: t('outdatedTag'),
            clauseLabel: t.raw('clauseLabel') as string,
            tier: {
              overdue_high_risk: t('tier.overdue_high_risk'),
              due_soon_high_risk: t('tier.due_soon_high_risk'),
              overdue: t('tier.overdue'),
              due_soon: t('tier.due_soon'),
              high_risk_undated: t('tier.high_risk_undated'),
              monitored: t('tier.monitored'),
            },
            severity: { high: tr('severity.high'), medium: tr('severity.medium'), low: tr('severity.low') },
            role: {
              party_a: t('role.party_a'),
              party_b: t('role.party_b'),
              both: t('role.both'),
              third_party: t('role.third_party'),
            },
            partyNames,
          }}
        />
      )}

      {view === 'calendar' && (
        <CalendarView
          milestones={intelligence.milestones}
          locale={locale}
          strings={{
            empty: t('calendar.empty'),
            emptyDescription: t('calendar.emptyDescription'),
            kind: {
              effective_date: t('calendar.kind.effective_date'),
              term_end: t('calendar.kind.term_end'),
              obligation: t('calendar.kind.obligation'),
            },
            derivedFrom: t('calendar.derivedFrom'),
            separator: t('derivation.separator'),
            anchor: {
              absolute_date: t('derivation.anchor.absolute_date'),
              effective_date: t('derivation.anchor.effective_date'),
              term_end: t('derivation.anchor.term_end'),
            },
            direction: { before: t('derivation.direction.before'), after: t('derivation.direction.after') },
            unit: {
              day: t('derivation.unit.day'),
              week: t('derivation.unit.week'),
              month: t('derivation.unit.month'),
              year: t('derivation.unit.year'),
            },
            urgency: { overdue: t('urgency.overdue'), soon: t('urgency.soon'), upcoming: t('urgency.upcoming') },
          }}
        />
      )}

      {view === 'obligations' && (
        <ObligationsView
          obligations={intelligence.obligations}
          locale={locale}
          strings={{
            empty: t('obligations.empty'),
            emptyDescription: t('obligations.emptyDescription'),
            filterAll: t('obligations.filterAll'),
            noMatches: t('obligations.noMatches'),
            noDeadline: t('noDeadline'),
            derivedFrom: t('calendar.derivedFrom'),
            separator: t('derivation.separator'),
            anchor: {
              absolute_date: t('derivation.anchor.absolute_date'),
              effective_date: t('derivation.anchor.effective_date'),
              term_end: t('derivation.anchor.term_end'),
            },
            direction: { before: t('derivation.direction.before'), after: t('derivation.direction.after') },
            unit: {
              day: t('derivation.unit.day'),
              week: t('derivation.unit.week'),
              month: t('derivation.unit.month'),
              year: t('derivation.unit.year'),
            },
            statedAs: t('obligations.statedAs'),
            status: {
              resolved: t('obligations.status.resolved'),
              unresolved: t('obligations.status.unresolved'),
              no_deadline_stated: t('obligations.status.no_deadline_stated'),
            },
            reason: {
              anchor_not_dated: t('obligations.reason.anchor_not_dated'),
              term_not_stated: t('obligations.reason.term_not_stated'),
              effective_date_not_stated: t('obligations.reason.effective_date_not_stated'),
              unit_not_computable: t('obligations.reason.unit_not_computable'),
              incomplete_spec: t('obligations.reason.incomplete_spec'),
            },
            role: {
              party_a: t('role.party_a'),
              party_b: t('role.party_b'),
              both: t('role.both'),
              third_party: t('role.third_party'),
            },
            partyNames,
          }}
        />
      )}

      {view === 'risk' && (
        <RiskView
          portfolio={buildRiskPortfolio(riskRows)}
          strings={{
            empty: tr('empty'),
            emptyDescription: tr('emptyDescription'),
            totalFindings: tr('totalFindings'),
            contractsAffected: tr('contractsAffected'),
            filterAll: tr('filterAll'),
            noMatches: tr('noMatches'),
            missingClause: tr('missingClause'),
            clauseLabel: tr.raw('clauseLabel') as string,
            severity: { high: tr('severity.high'), medium: tr('severity.medium'), low: tr('severity.low') },
          }}
        />
      )}

      {view === 'ask' && (
        <AskView
          initialMessages={askHistory.map((m) => ({ id: m.id, role: m.role, content: m.content, citations: m.citations, notFound: m.notFound }))}
          strings={{
            empty: t('ask.empty'),
            placeholder: t('ask.placeholder'),
            send: t('ask.send'),
            notFound: t('ask.notFound'),
            errors: {
              unknown: t('ask.errors.unknown'),
              ai_disabled: t('ask.errors.ai_disabled'),
              quota_exceeded: t('ask.errors.quota_exceeded'),
              upstream_failed: t('ask.errors.upstream_failed'),
              invalid_request: t('ask.errors.unknown'),
            },
          }}
        />
      )}
    </IntelligenceShell>
  )
}
