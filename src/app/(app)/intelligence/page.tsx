import { getLocale, getTranslations } from 'next-intl/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/org/current'
import { isCurrentSchema } from '@/lib/ai/schema-version'
import { buildIntelligence, type InputContract, type InputFinding, type InputObligation } from '@/lib/intelligence/build'
import { buildRiskPortfolio, type RawFinding } from '@/lib/risk/portfolio'
import { IntelligenceShell } from './intelligence-shell'
import { AttentionView } from './attention-view'
import { CalendarView } from './calendar-view'
import { ObligationsView } from './obligations-view'
import { RiskView } from '../risk/risk-view'

export type View = 'attention' | 'calendar' | 'obligations' | 'risk'

const VIEWS: readonly View[] = ['attention', 'calendar', 'obligations', 'risk']

type StoredObligation = {
  clauseId?: string | null
  obligor: string
  partyRole?: InputObligation['partyRole']
  action: string
  due: string | null
  dueSpec?: InputObligation['dueSpec']
}

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

  // One read of every ready analysis, plus the findings they own. Everything
  // the four views need is derived from this -- the whole point of a single
  // aggregation is that the page does not fan out per view.
  const [{ data: analyses }, { data: contracts }] = await Promise.all([
    supabase
      .from('analyses')
      .select('id, contract_id, obligations, obligation_parties, fields, schema_version, created_at')
      .eq('org_id', orgId)
      .eq('status', 'ready')
      .order('created_at', { ascending: false }),
    supabase.from('contracts').select('id, title').eq('org_id', orgId),
  ])

  const titleById = new Map((contracts ?? []).map((c) => [c.id as string, c.title as string]))

  // A contract can have several analyses (re-analysis, new versions); rows
  // come back newest-first, so the first sighting of a contract_id is its
  // latest. Later rows are superseded, exactly as the risk portfolio treats
  // them.
  const seen = new Set<string>()
  const latest: Array<{ id: string; contractId: string; row: NonNullable<typeof analyses>[number] }> = []
  for (const a of analyses ?? []) {
    const contractId = a.contract_id as string
    if (seen.has(contractId) || !titleById.has(contractId)) continue
    seen.add(contractId)
    latest.push({ id: a.id as string, contractId, row: a })
  }

  const { data: findingRows } = latest.length
    ? await supabase
        .from('risk_findings')
        .select('id, analysis_id, clause_id, kind, severity, title, reason, reason_ar, rule_key')
        .in(
          'analysis_id',
          latest.map((l) => l.id),
        )
    : { data: null }

  const findingsByAnalysis = new Map<string, typeof findingRows>()
  for (const f of findingRows ?? []) {
    const list = findingsByAnalysis.get(f.analysis_id as string) ?? []
    list.push(f)
    findingsByAnalysis.set(f.analysis_id as string, list as typeof findingRows)
  }

  const input: InputContract[] = latest.map(({ id, contractId, row }) => {
    const fields = (row.fields as Record<string, unknown> | null) ?? null
    const storedParties = row.obligation_parties as string[] | null
    const fieldParties = Array.isArray(fields?.parties) ? (fields!.parties as string[]) : []
    return {
      contractId,
      title: titleById.get(contractId)!,
      effectiveDate: (fields?.effectiveDate as string | null) ?? null,
      termLength: (fields?.termLength as string | null) ?? null,
      // The obligations task's own party list defines party_a/party_b; the
      // fields task's list is the display fallback for older analyses.
      parties: storedParties?.length ? storedParties : fieldParties,
      findings: (findingsByAnalysis.get(id) ?? []).map(
        (f): InputFinding => ({
          id: f.id as string,
          clauseId: (f.clause_id as string | null) ?? null,
          kind: (f.kind as InputFinding['kind']) ?? 'playbook',
          severity: f.severity as InputFinding['severity'],
          title: f.title as string,
        }),
      ),
      obligations: ((row.obligations as StoredObligation[] | null) ?? []).map(
        (o): InputObligation => ({
          clauseId: o.clauseId ?? null,
          obligor: o.obligor,
          partyRole: o.partyRole ?? null,
          action: o.action,
          due: o.due,
          dueSpec: o.dueSpec ?? null,
        }),
      ),
      current: isCurrentSchema(row.schema_version as number | null),
    }
  })

  const intelligence = buildIntelligence(input, new Date())

  // The risk view is reused unchanged, so it still takes the portfolio shape
  // it was built for -- absorbing a page into a section should not mean
  // rewriting what already worked.
  const riskRows: RawFinding[] = latest.flatMap(({ id, contractId }) =>
    (findingsByAnalysis.get(id) ?? []).map((f) => ({
      id: f.id as string,
      contractId,
      contractTitle: titleById.get(contractId)!,
      clauseId: (f.clause_id as string | null) ?? null,
      clauseNumber: null,
      severity: f.severity as 'high' | 'medium' | 'low',
      title: f.title as string,
      reason: (locale === 'ar' ? ((f.reason_ar as string | null) ?? (f.reason as string)) : (f.reason as string)) as string,
      ruleKey: (f.rule_key as string | null) ?? null,
    })),
  )

  const partyNamesByContract = Object.fromEntries(input.map((c) => [c.contractId, c.parties]))

  const shellStrings = {
    title: t('title'),
    subtitle: t('subtitle'),
    views: {
      attention: t('views.attention'),
      calendar: t('views.calendar'),
      obligations: t('views.obligations'),
      risk: t('views.risk'),
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
            partyNames: partyNamesByContract,
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
            partyNames: partyNamesByContract,
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
    </IntelligenceShell>
  )
}
