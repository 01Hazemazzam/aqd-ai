import { getLocale, getTranslations } from 'next-intl/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/org/current'
import { buildRiskPortfolio, type RawFinding, type Severity } from '@/lib/risk/portfolio'
import { RiskView } from './risk-view'

export default async function RiskPage() {
  const t = await getTranslations('risk')
  const locale = await getLocale()
  const orgId = await getCurrentOrgId()
  const supabase = await createServerSupabase()

  // Only findings from each contract's LATEST ready analysis belong in the
  // portfolio -- re-analysis leaves older analyses in place, and counting
  // those too would double-count every finding. Analyses come back
  // newest-first, so the first row per contract_id is the current one.
  const [{ data: analyses }, { data: contracts }] = await Promise.all([
    supabase
      .from('analyses')
      .select('id, contract_id, created_at')
      .eq('org_id', orgId)
      .eq('status', 'ready')
      .order('created_at', { ascending: false }),
    supabase.from('contracts').select('id, title').eq('org_id', orgId),
  ])

  const titleById = new Map((contracts ?? []).map((c) => [c.id as string, c.title as string]))
  const latestAnalysisIds: string[] = []
  const contractByAnalysis = new Map<string, string>()
  const seen = new Set<string>()
  for (const a of analyses ?? []) {
    const contractId = a.contract_id as string
    if (seen.has(contractId) || !titleById.has(contractId)) continue
    seen.add(contractId)
    latestAnalysisIds.push(a.id as string)
    contractByAnalysis.set(a.id as string, contractId)
  }

  // RLS already scopes risk_findings to the org; the analysis_id filter is
  // what narrows them to the current analyses.
  const { data: findings } = latestAnalysisIds.length
    ? await supabase
        .from('risk_findings')
        .select('id, analysis_id, clause_id, rule_key, severity, title, reason, reason_ar')
        .in('analysis_id', latestAnalysisIds)
    : { data: null }

  // Clause numbers are what the UI shows ("Clause 4.2"), but findings only
  // carry clause_id -- one extra read resolves them.
  const clauseIds = [...new Set((findings ?? []).map((f) => f.clause_id).filter((id): id is string => !!id))]
  const { data: clauses } = clauseIds.length
    ? await supabase.from('clauses').select('id, clause_number').in('id', clauseIds)
    : { data: null }
  const clauseNumberById = new Map((clauses ?? []).map((c) => [c.id as string, c.clause_number as string | null]))

  // The Arabic reason is resolved here, not in the view, so the aggregation
  // module and the view both stay language-agnostic. Falls back to the
  // English reason when reason_ar is absent (older analyses, or a task that
  // returned no Arabic text).
  const rows: RawFinding[] = (findings ?? []).flatMap((f) => {
    const contractId = contractByAnalysis.get(f.analysis_id as string)
    if (!contractId) return []
    const contractTitle = titleById.get(contractId)
    if (!contractTitle) return []
    const reasonAr = f.reason_ar as string | null
    return [
      {
        id: f.id as string,
        contractId,
        contractTitle,
        clauseId: (f.clause_id as string | null) ?? null,
        clauseNumber: f.clause_id ? clauseNumberById.get(f.clause_id as string) ?? null : null,
        severity: f.severity as Severity,
        title: f.title as string,
        reason: locale === 'ar' && reasonAr ? reasonAr : (f.reason as string),
        ruleKey: (f.rule_key as string | null) ?? null,
      },
    ]
  })

  const portfolio = buildRiskPortfolio(rows)

  return (
    <RiskView
      portfolio={portfolio}
      strings={{
        title: t('title'),
        subtitle: t('subtitle'),
        empty: t('empty'),
        emptyDescription: t('emptyDescription'),
        totalFindings: t('totalFindings'),
        contractsAffected: t('contractsAffected'),
        filterAll: t('filterAll'),
        noMatches: t('noMatches'),
        missingClause: t('missingClause'),
        // Raw template, not a bound formatter: the view is a Client
        // Component and functions can't cross that boundary.
        clauseLabel: t.raw('clauseLabel') as string,
        severity: { high: t('severity.high'), medium: t('severity.medium'), low: t('severity.low') },
      }}
    />
  )
}
