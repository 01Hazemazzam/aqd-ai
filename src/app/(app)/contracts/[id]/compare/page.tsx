import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, GitCompare } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { FadeIn } from '@/components/ui/reveal'
import { cn } from '@/components/ui/cn'
import { compareVersions, type RevisionClause } from '@/lib/revision/align'
import { compareRiskFindings, type DeltaFinding, type RiskDelta } from '@/lib/revision/risk-delta'
import { RevisionUpload } from '../revision-upload'
import { CompareView, type ChangeItem } from './compare-view'

type ClauseRow = { id: string; ordinal: number; clause_number: string | null; lang: string | null; body: string }

const toRevisionClause = (row: ClauseRow): RevisionClause => ({
  id: row.id,
  ordinal: row.ordinal,
  clauseNumber: row.clause_number,
  lang: row.lang === 'ar' ? 'ar' : 'en',
  body: row.body,
})

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ base?: string; revised?: string }>
}) {
  const { id } = await params
  const { base: baseParam, revised: revisedParam } = await searchParams
  const t = await getTranslations('contracts')
  const supabase = await createServerSupabase()

  const [{ data: contract }, { data: versions }] = await Promise.all([
    supabase.from('contracts').select('id, title').eq('id', id).maybeSingle(),
    supabase.from('contract_versions').select('id, version_no').eq('contract_id', id).order('version_no', { ascending: true }),
  ])
  if (!contract) notFound()

  const backLink = (
    <Link href={`/contracts/${id}`} className="mb-6 inline-flex items-center gap-1.5 text-sm text-accent hover:underline">
      <ArrowLeft size={15} aria-hidden="true" className="rtl:rotate-180" />
      {t('compare.backToContract')}
    </Link>
  )

  // One version is not a comparison. Offering the upload here rather than
  // sending the reader back to the reader to find it is the whole reason this
  // state has its own copy.
  if (!versions || versions.length < 2) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-20 sm:px-10">
        {backLink}
        <Card>
          <EmptyState
            icon={<GitCompare size={22} aria-hidden="true" />}
            title={t('compare.onlyOneVersion')}
            description={t('compare.onlyOneVersionHint')}
            action={<RevisionUpload contractId={id} />}
          />
        </Card>
      </main>
    )
  }

  const numbers = versions.map((v) => v.version_no as number)
  const latest = numbers[numbers.length - 1]
  const parse = (raw: string | undefined, fallback: number) => {
    const n = Number(raw)
    return Number.isInteger(n) && numbers.includes(n) ? n : fallback
  }
  // A hand-edited URL is the ordinary way to land here with nonsense in it,
  // and the pair still has to mean something: a version compared with itself,
  // or with a later one, would render a diff that reads backwards.
  let baseNo = parse(baseParam, numbers[numbers.length - 2])
  let revisedNo = parse(revisedParam, latest)
  if (baseNo === revisedNo) baseNo = numbers[Math.max(0, numbers.indexOf(revisedNo) - 1)]
  if (baseNo > revisedNo) [baseNo, revisedNo] = [revisedNo, baseNo]

  const baseVersion = versions.find((v) => v.version_no === baseNo)!
  const revisedVersion = versions.find((v) => v.version_no === revisedNo)!

  const clausesOf = (versionId: string) =>
    supabase
      .from('clauses')
      .select('id, ordinal, clause_number, lang, body')
      .eq('version_id', versionId)
      .order('ordinal', { ascending: true })

  // The latest analysis OF THAT VERSION, not of the contract: a re-analysis
  // supersedes its predecessor within one version, and the analysis of a
  // different version is not evidence about this one.
  const analysisOf = (versionId: string) =>
    supabase
      .from('analyses')
      .select('id, status')
      .eq('version_id', versionId)
      .eq('status', 'ready')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

  const [{ data: baseClauses }, { data: revisedClauses }, { data: baseAnalysis }, { data: revisedAnalysis }] = await Promise.all([
    clausesOf(baseVersion.id),
    clausesOf(revisedVersion.id),
    analysisOf(baseVersion.id),
    analysisOf(revisedVersion.id),
  ])

  const findingsOf = async (analysisId: string | undefined): Promise<DeltaFinding[] | null> => {
    if (!analysisId) return null
    const { data } = await supabase
      .from('risk_findings')
      .select('id, rule_key, kind, severity, title')
      .eq('analysis_id', analysisId)
    return (data ?? []).map((f) => ({
      id: f.id as string,
      ruleKey: (f.rule_key as string | null) ?? null,
      kind: (f.kind as string | null) ?? 'playbook',
      severity: f.severity as DeltaFinding['severity'],
      title: f.title as string,
    }))
  }

  const [baseFindings, revisedFindings] = await Promise.all([
    findingsOf(baseAnalysis?.id as string | undefined),
    findingsOf(revisedAnalysis?.id as string | undefined),
  ])

  const comparison = compareVersions(
    ((baseClauses ?? []) as ClauseRow[]).map(toRevisionClause),
    ((revisedClauses ?? []) as ClauseRow[]).map(toRevisionClause),
  )

  // Both sides or nothing. A delta against a version that was never analyzed
  // would report every finding in the analyzed one as "introduced by this
  // revision", which is a fabricated causal claim.
  const delta: RiskDelta | null =
    baseFindings && revisedFindings ? compareRiskFindings(baseFindings, revisedFindings) : null

  // Every label resolved here, where the translator lives. A `t()` closure
  // cannot cross into a client component, and the view has no business
  // holding message keys anyway.
  const items: ChangeItem[] = comparison.changes.map((change, i) => {
    const clause = change.kind === 'removed' ? change.base : change.revised
    const renumbered =
      'base' in change && 'revised' in change && change.base.clauseNumber && change.base.clauseNumber !== change.revised.clauseNumber
        ? t('compare.wasNumbered', { number: change.base.clauseNumber })
        : null
    return {
      key: `${change.kind}-${clause.id}-${i}`,
      kind: change.kind,
      title: clause.clauseNumber ? t('clauseHeading', { number: clause.clauseNumber }) : t('untitledClause'),
      renumberedFrom: renumbered,
      dir: clause.lang === 'ar' ? 'rtl' : 'ltr',
      body: clause.body,
      ...(change.kind === 'modified' ? { before: change.base.body, after: change.revised.body } : {}),
    }
  })

  const versionHref = (nextBase: number, nextRevised: number) =>
    `/contracts/${id}/compare?base=${nextBase}&revised=${nextRevised}`

  const picker = (which: 'base' | 'revised') => (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
        {which === 'base' ? t('compare.baseLabel') : t('compare.revisedLabel')}
      </span>
      {numbers.map((n) => {
        const selected = n === (which === 'base' ? baseNo : revisedNo)
        return (
          <Link
            key={n}
            href={which === 'base' ? versionHref(n, revisedNo) : versionHref(baseNo, n)}
            aria-current={selected ? 'true' : undefined}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
              selected ? 'border-accent bg-surface-3 text-accent' : 'border-edge text-ink-dim hover:text-ink',
            )}
          >
            {t('versionShort', { number: n })}
          </Link>
        )
      })}
    </div>
  )

  return (
    <main className="mx-auto max-w-4xl px-6 py-20 sm:px-10">
      {backLink}

      <FadeIn>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-ink-dim">
          <span className="font-semibold text-ink">{t('versionShort', { number: baseNo })}</span>
          <ArrowRight size={15} aria-hidden="true" className="text-ink-faint rtl:rotate-180" />
          <span className="font-semibold text-ink">{t('versionShort', { number: revisedNo })}</span>
        </div>
        <h1 className="mb-1 text-balance break-words font-serif text-3xl font-medium tracking-tight text-ink">
          {t('compare.title')}
        </h1>
        <p className="mb-8 break-words text-sm text-ink-dim">{contract.title}</p>

        {numbers.length > 2 && (
          <div className="mb-8 flex flex-col gap-3 rounded-xl border border-edge bg-surface-2 p-4">
            {picker('base')}
            {picker('revised')}
          </div>
        )}

        <CompareView
          items={items}
          counts={comparison.counts}
          identical={comparison.identical}
          delta={delta}
          strings={{
            summary: {
              unchanged: t('compare.summary.unchanged'),
              modified: t('compare.summary.modified'),
              added: t('compare.summary.added'),
              removed: t('compare.summary.removed'),
            },
            identical: t('compare.identical'),
            changeLabel: {
              unchanged: t('compare.changeLabel.unchanged'),
              modified: t('compare.changeLabel.modified'),
              added: t('compare.changeLabel.added'),
              removed: t('compare.changeLabel.removed'),
            },
            changesTitle: t('compare.changesTitle'),
            showUnchanged: t('compare.showUnchanged'),
            hideUnchanged: t('compare.hideUnchanged'),
            risk: {
              title: t('compare.risk.title'),
              introduced: t('compare.risk.introduced'),
              noLongerReported: t('compare.risk.noLongerReported'),
              noLongerReportedHint: t('compare.risk.noLongerReportedHint'),
              carried: t('compare.risk.carried'),
              worse: t('compare.risk.worse'),
              better: t('compare.risk.better'),
              unchangedProfile: t('compare.risk.unchangedProfile'),
              notAnalyzed: t('compare.risk.notAnalyzed'),
            },
          }}
        />
      </FadeIn>
    </main>
  )
}
