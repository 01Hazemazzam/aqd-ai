import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { ClauseRow } from '@/components/ui/clause-row'
import { Card } from '@/components/ui/card'

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

  return (
    <main className="mx-auto max-w-4xl px-6 py-20 sm:px-10">
      <Link href="/contracts" className="mb-6 inline-block text-sm text-accent underline">
        {t('backToList')}
      </Link>
      <h1 className="mb-8 font-serif text-3xl font-medium tracking-tight text-ink text-balance">{contract.title}</h1>

      {contract.status !== 'ready' && contract.status !== 'failed' && (
        <Card><p className="text-sm text-ink-dim">{t('status.parsing')}</p></Card>
      )}

      {contract.status === 'failed' && (
        <Card><p role="alert" className="text-sm text-risk-high">{t('parseFailed')}</p></Card>
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
