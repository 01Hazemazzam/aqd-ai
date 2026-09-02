import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, FileWarning, AlertTriangle, Sparkles } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { ClauseRow } from '@/components/ui/clause-row'
import { Card } from '@/components/ui/card'
import { SkeletonText, Skeleton } from '@/components/ui/skeleton'
import { FadeIn, StaggerList, StaggerItem } from '@/components/ui/reveal'
import { AnalyzeButton } from './analyze-button'
import { AnalysisRail } from './analysis-rail'
import { ClauseHashFocus } from './clause-hash-focus'
import { buildChatHistory } from '@/lib/chat/build-history'

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 } as const

export default async function ContractReaderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const t = await getTranslations('contracts')
  const supabase = await createServerSupabase()

  // Four independent reads (each keyed only on the route's own contractId,
  // not on each other's results) previously ran as five-plus sequential
  // round trips. Batched here -- same queries, same RLS, just not waiting on
  // each other -- cuts this page's DB latency roughly in half.
  const [{ data: contract }, { data: version }, { data: analysis }, { data: chat }] = await Promise.all([
    supabase.from('contracts').select('id, title, status, error').eq('id', id).maybeSingle(),
    supabase.from('contract_versions').select('id').eq('contract_id', id).order('version_no', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('analyses').select('id, status, error, summary, fields, obligations').eq('contract_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('chats').select('id').eq('contract_id', id).maybeSingle(),
  ])
  if (!contract) notFound()

  const [{ data: clauses }, { data: findings }, { data: chatMessages }] = await Promise.all([
    version
      ? supabase.from('clauses').select('id, ordinal, clause_number, lang, body').eq('version_id', version.id).order('ordinal', { ascending: true })
      : Promise.resolve({ data: null }),
    analysis
      ? supabase.from('risk_findings').select('id, clause_id, severity, title, reason').eq('analysis_id', analysis.id)
      : Promise.resolve({ data: null }),
    chat
      ? supabase.from('chat_messages').select('id, role, content, not_found').eq('chat_id', chat.id).order('created_at', { ascending: true })
      : Promise.resolve({ data: null }),
  ])

  const messageIds = (chatMessages ?? []).map((m) => m.id)
  const { data: citationRows } = messageIds.length
    ? await supabase.from('citations').select('message_id, ordinal, clause_id').in('message_id', messageIds)
    : { data: null }
  const clauseIds = [...new Set((citationRows ?? []).map((c) => c.clause_id))]
  const { data: citedClauses } = clauseIds.length
    ? await supabase.from('clauses').select('id, clause_number').in('id', clauseIds)
    : { data: null }
  const clauseNumberById = new Map((citedClauses ?? []).map((c) => [c.id, c.clause_number]))

  const initialMessages = buildChatHistory(
    (chatMessages ?? []) as Array<{ id: string; role: 'user' | 'assistant'; content: string; not_found: boolean }>,
    citationRows ?? [],
    clauseNumberById,
    t('chat.notFound'),
  )

  const severityByClause = new Map<string, 'high' | 'medium' | 'low'>()
  for (const f of findings ?? []) {
    if (!f.clause_id) continue
    const current = severityByClause.get(f.clause_id)
    if (!current || SEVERITY_RANK[f.severity as keyof typeof SEVERITY_RANK] > SEVERITY_RANK[current]) {
      severityByClause.set(f.clause_id, f.severity)
    }
  }
  // Findings with no clause_id (about a clause the document is MISSING) used
  // to need their own "other findings" card, because the inline clause gutter
  // had nowhere to put them. The rail lists every finding together and marks
  // the unplaced ones, so they no longer need separating here.
  const fields = analysis?.fields as Record<string, string | string[] | null> | null
  const obligations = (analysis?.obligations as Array<{ obligor: string; action: string; due: string | null }> | null) ?? []

  // max-w-6xl, not the 4xl a single column used: the rail takes a fixed
  // 380px, so a 4xl container left the clause text only ~400px -- narrower
  // than the rail beside it. At 6xl the document reads at ~740px.
  return (
    <main className="mx-auto max-w-6xl px-6 py-20 sm:px-10">
      <ClauseHashFocus />
      <Link href="/contracts" className="mb-6 inline-flex items-center gap-1.5 text-sm text-accent hover:underline">
        <ArrowLeft size={15} aria-hidden="true" className="rtl:rotate-180" />
        {t('backToList')}
      </Link>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* break-words is load-bearing: titles come from uploaded filenames
            and are routinely a single unbroken token
            ("Aqd_AI_QA_Stress_Test_Contract"). text-balance offers no break
            opportunity *inside* a token, so without this the heading pushes
            the document wider than a 375px viewport and the whole page
            scrolls sideways. */}
        <h1 className="text-balance break-words font-serif text-3xl font-medium tracking-tight text-ink">
          {contract.title}
        </h1>
        {contract.status === 'ready' && !!clauses?.length && (
          <AnalyzeButton contractId={id} label={analysis ? t('reanalyzeCta') : t('analyzeCta')} />
        )}
      </div>

      {contract.status !== 'ready' && contract.status !== 'failed' && (
        <Card className="mb-6">
          <div className="mb-4 flex items-center gap-2 text-sm font-medium text-ink-dim">
            <span className="skeleton h-2 w-2 shrink-0 rounded-full" aria-hidden="true" />
            {t('status.parsing')}
          </div>
          <SkeletonText lines={4} />
        </Card>
      )}

      {contract.status === 'failed' && (
        <Card className="mb-6 flex items-start gap-3">
          <FileWarning size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-risk-high" />
          <p role="alert" className="text-sm text-risk-high">{t('parseFailed')}</p>
        </Card>
      )}

      {analysis?.status === 'pending' && (
        <div className="mb-8 flex flex-col gap-4">
          <Card>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
              <Sparkles size={15} aria-hidden="true" className="text-accent" />
              {t('analyzing')}
            </div>
            <SkeletonText lines={3} />
          </Card>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card><Skeleton className="h-24 w-full" /></Card>
            <Card><Skeleton className="h-24 w-full" /></Card>
          </div>
        </div>
      )}

      {analysis?.status === 'failed' && (
        <Card className="mb-6 flex items-start gap-3">
          <AlertTriangle size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-risk-high" />
          <p role="alert" className="text-sm text-risk-high">
            {t(`analyzeErrors.${analysis.error}` as 'analyzeErrors.unknown')}
          </p>
        </Card>
      )}

      {analysis?.status === 'ready' && analysis.error === 'partial' && (
        <Card className="mb-6 flex items-start gap-3">
          <AlertTriangle size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-risk-high" />
          <p role="status" className="text-sm text-risk-high">{t('partialAnalysisNotice')}</p>
        </Card>
      )}

      {/* Document beside its analysis. The rail is DOM-first so that on small
          screens the analysis leads and the contract follows; from `lg` the
          order flips (document left, rail right) and the rail goes sticky. */}
      {contract.status === 'ready' && !!clauses?.length && (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
          <AnalysisRail
            contractId={id}
            clauses={(clauses ?? []).map((c) => ({
              id: c.id as string,
              ordinal: c.ordinal as number,
              clauseNumber: (c.clause_number as string | null) ?? null,
              lang: (c.lang as string | null) ?? null,
              body: c.body as string,
            }))}
            findings={(findings ?? []).map((f) => ({
              id: f.id as string,
              clauseId: (f.clause_id as string | null) ?? null,
              severity: f.severity as 'high' | 'medium' | 'low',
              title: f.title as string,
              reason: f.reason as string,
            }))}
            summary={(analysis?.summary as string | null) ?? null}
            fields={fields}
            obligations={obligations}
            initialMessages={initialMessages}
          />

          <FadeIn className="lg:order-1">
            <StaggerList className="flex flex-col gap-3">
              {clauses.map((clause) => (
                <StaggerItem key={clause.id}>
                  <ClauseRow
                    id={`clause-${clause.id}`}
                    number={clause.clause_number ?? String(clause.ordinal)}
                    heading={clause.clause_number ? t('clauseHeading', { number: clause.clause_number }) : t('untitledClause')}
                    body={clause.body}
                    dir={clause.lang === 'ar' ? 'rtl' : 'ltr'}
                    severity={severityByClause.get(clause.id) ?? 'none'}
                  />
                </StaggerItem>
              ))}
            </StaggerList>
          </FadeIn>
        </div>
      )}

      {contract.status === 'ready' && !clauses?.length && (
        <Card><p className="text-sm text-ink-dim">{t('empty')}</p></Card>
      )}
    </main>
  )
}
