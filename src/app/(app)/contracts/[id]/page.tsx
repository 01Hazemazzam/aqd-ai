import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { ClauseRow } from '@/components/ui/clause-row'
import { Card } from '@/components/ui/card'
import { AnalyzeButton } from './analyze-button'

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 } as const

export default async function ContractReaderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const t = await getTranslations('contracts')
  const supabase = await createServerSupabase()

  const { data: contract } = await supabase
    .from('contracts')
    .select('id, title, status, error')
    .eq('id', id)
    .maybeSingle()
  if (!contract) notFound()

  const { data: version } = await supabase
    .from('contract_versions')
    .select('id')
    .eq('contract_id', id)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: clauses } = version
    ? await supabase
        .from('clauses')
        .select('id, ordinal, clause_number, lang, body')
        .eq('version_id', version.id)
        .order('ordinal', { ascending: true })
    : { data: null }

  const { data: analysis } = await supabase
    .from('analyses')
    .select('id, status, error, summary, fields, obligations')
    .eq('contract_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: findings } = analysis
    ? await supabase
        .from('risk_findings')
        .select('id, clause_id, severity, title, reason')
        .eq('analysis_id', analysis.id)
    : { data: null }

  const severityByClause = new Map<string, 'high' | 'medium' | 'low'>()
  for (const f of findings ?? []) {
    if (!f.clause_id) continue
    const current = severityByClause.get(f.clause_id)
    if (!current || SEVERITY_RANK[f.severity as keyof typeof SEVERITY_RANK] > SEVERITY_RANK[current]) {
      severityByClause.set(f.clause_id, f.severity)
    }
  }
  const unplacedFindings = (findings ?? []).filter((f) => !f.clause_id)
  const fields = analysis?.fields as Record<string, string | string[] | null> | null
  const obligations = (analysis?.obligations as Array<{ obligor: string; action: string; due: string | null }> | null) ?? []

  return (
    <main className="mx-auto max-w-4xl px-6 py-20 sm:px-10">
      <Link href="/contracts" className="mb-6 inline-block text-sm text-accent underline">
        {t('backToList')}
      </Link>
      <div className="mb-8 flex items-center justify-between gap-4">
        <h1 className="font-serif text-3xl font-medium tracking-tight text-ink text-balance">{contract.title}</h1>
        {contract.status === 'ready' && !!clauses?.length && (
          <AnalyzeButton contractId={id} label={analysis ? t('reanalyzeCta') : t('analyzeCta')} />
        )}
      </div>

      {contract.status !== 'ready' && contract.status !== 'failed' && (
        <Card><p className="text-sm text-ink-dim">{t('status.parsing')}</p></Card>
      )}

      {contract.status === 'failed' && (
        <Card><p role="alert" className="text-sm text-risk-high">{t('parseFailed')}</p></Card>
      )}

      {analysis?.status === 'pending' && (
        <Card className="mb-6"><p className="text-sm text-ink-dim">{t('analyzing')}</p></Card>
      )}

      {analysis?.status === 'failed' && (
        <Card className="mb-6">
          <p role="alert" className="text-sm text-risk-high">
            {t(`analyzeErrors.${analysis.error}` as 'analyzeErrors.unknown')}
          </p>
        </Card>
      )}

      {analysis?.status === 'ready' && (
        <div className="mb-8 flex flex-col gap-4">
          {analysis.summary && (
            <Card>
              <h2 className="mb-2 text-sm font-semibold text-ink">{t('summaryTitle')}</h2>
              <p className="text-sm leading-relaxed text-ink-dim">{analysis.summary}</p>
            </Card>
          )}

          {fields && (
            <Card>
              <h2 className="mb-3 text-sm font-semibold text-ink">{t('fieldsTitle')}</h2>
              <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                {Object.entries(fields).map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-ink-faint">{t(`fieldLabels.${key}` as 'fieldLabels.parties')}</dt>
                    <dd className="text-ink-dim">{Array.isArray(value) ? value.join(', ') || '—' : value ?? '—'}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}

          {obligations.length > 0 && (
            <Card>
              <h2 className="mb-3 text-sm font-semibold text-ink">{t('obligationsTitle')}</h2>
              <ul className="flex flex-col gap-2 text-sm">
                {obligations.map((o, i) => (
                  <li key={i} className="text-ink-dim">
                    <span className="font-medium text-ink">{o.obligor}</span>: {o.action}
                    {o.due && <span className="text-ink-faint"> — {o.due}</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {unplacedFindings.length > 0 && (
            <Card>
              <h2 className="mb-3 text-sm font-semibold text-ink">{t('generalFindingsTitle')}</h2>
              <ul className="flex flex-col gap-2 text-sm">
                {unplacedFindings.map((f) => (
                  <li key={f.id} role="alert" className="text-ink-dim">
                    <span className="font-medium text-risk-high">{f.title}</span>: {f.reason}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {contract.status === 'ready' && !!clauses?.length && (
        <div className="flex flex-col gap-3">
          {clauses.map((clause) => (
            <ClauseRow
              key={clause.id}
              number={clause.clause_number ?? String(clause.ordinal)}
              heading={clause.clause_number ? t('clauseHeading', { number: clause.clause_number }) : t('untitledClause')}
              body={clause.body}
              dir={clause.lang === 'ar' ? 'rtl' : 'ltr'}
              severity={severityByClause.get(clause.id) ?? 'none'}
            />
          ))}
        </div>
      )}

      {contract.status === 'ready' && !clauses?.length && (
        <Card><p className="text-sm text-ink-dim">{t('empty')}</p></Card>
      )}
    </main>
  )
}
