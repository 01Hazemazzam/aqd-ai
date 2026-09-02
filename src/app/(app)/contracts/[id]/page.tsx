import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, FileWarning, AlertTriangle, Sparkles, GitCompare } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { ClauseRow } from '@/components/ui/clause-row'
import { Card } from '@/components/ui/card'
import { SkeletonText, Skeleton } from '@/components/ui/skeleton'
import { FadeIn, StaggerList, StaggerItem } from '@/components/ui/reveal'
import { AnalyzeButton } from './analyze-button'
import { AnalysisRail } from './analysis-rail'
import { RevisionUpload } from './revision-upload'
import { ClauseHashFocus } from './clause-hash-focus'
import { buildChatHistory } from '@/lib/chat/build-history'

// The deployment target kills a function at 60s. Declared explicitly rather
// than left to the platform default (10s), which is shorter than a healthy
// analysis. The AI retry budget in lib/ai/router.ts is sized to fit inside
// this with room for the database writes that follow -- change one and check
// the other.
export const maxDuration = 60

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 } as const

export default async function ContractReaderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const t = await getTranslations('contracts')
  const supabase = await createServerSupabase()

  // Four independent reads (each keyed only on the route's own contractId,
  // not on each other's results) previously ran as five-plus sequential
  // round trips. Batched here -- same queries, same RLS, just not waiting on
  // each other -- cuts this page's DB latency roughly in half.
  const [{ data: contract }, { data: versions }, { data: latestAnalysis }, { data: chat }] = await Promise.all([
    supabase.from('contracts').select('id, title, status, error').eq('id', id).maybeSingle(),
    // Every version, not just the newest: the reader shows the current draft,
    // but it has to be able to say which draft that is and offer the
    // comparison, and one extra column costs nothing to carry.
    supabase.from('contract_versions').select('id, version_no').eq('contract_id', id).order('version_no', { ascending: false }),
    supabase.from('analyses').select('id, version_id, status, error, summary, fields, obligations').eq('contract_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('chats').select('id').eq('contract_id', id).maybeSingle(),
  ])
  if (!contract) notFound()
  const version = versions?.[0] ?? null
  const versionCount = versions?.length ?? 0

  // An analysis belongs to the version it read, and this page renders the
  // newest version. Once a contract can carry a revision those two come
  // apart: the newest analysis is the previous draft's until the new one is
  // analyzed, and showing its findings beside the new clause text would
  // attribute risks to wording that no longer exists -- with the gutter
  // severities landing on clause ids the document no longer contains.
  // Dropping it says "not analyzed yet", which is what is true.
  const analysis = latestAnalysis && latestAnalysis.version_id === version?.id ? latestAnalysis : null

  const [{ data: clauses }, { data: findings }, { data: chatMessages }] = await Promise.all([
    version
      ? supabase.from('clauses').select('id, ordinal, clause_number, lang, body').eq('version_id', version.id).order('ordinal', { ascending: true })
      : Promise.resolve({ data: null }),
    analysis
      ? supabase.from('risk_findings').select('id, clause_id, kind, severity, title, reason').eq('analysis_id', analysis.id)
      : Promise.resolve({ data: null }),
    chat
      ? supabase.from('chat_messages').select('id, role, content, not_found').eq('chat_id', chat.id).order('created_at', { ascending: true })
      : Promise.resolve({ data: null }),
  ])

  // Evidence spans are a separate read because a finding can quote several
  // clauses -- a cross-clause finding cites one on each side of the
  // relationship it reports.
  const findingIds = (findings ?? []).map((f) => f.id as string)
  const { data: evidenceRows } = findingIds.length
    ? await supabase
        .from('finding_evidence')
        .select('finding_id, clause_id, quote, ordinal')
        .in('finding_id', findingIds)
        .order('ordinal', { ascending: true })
    : { data: null }
  const evidenceByFinding = new Map<string, Array<{ clauseId: string; quote: string }>>()
  for (const row of evidenceRows ?? []) {
    const list = evidenceByFinding.get(row.finding_id as string) ?? []
    list.push({ clauseId: row.clause_id as string, quote: row.quote as string })
    evidenceByFinding.set(row.finding_id as string, list)
  }

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
          <div className="flex flex-wrap items-center gap-2">
            <RevisionUpload contractId={id} />
            <AnalyzeButton contractId={id} label={analysis ? t('reanalyzeCta') : t('analyzeCta')} />
          </div>
        )}
      </div>

      {/* Which draft is on screen. Silent until there is a second version --
          on a contract with one version the answer is "the contract", and
          saying "version 1 of 1" would only invite the question. */}
      {versionCount > 1 && version && (
        <div className="mb-8 flex flex-wrap items-center gap-3 rounded-xl border border-edge bg-surface-2 px-4 py-3">
          <span className="text-sm font-semibold text-ink">
            {t('versionOf', { number: version.version_no as number, total: versionCount })}
          </span>
          <Link
            href={`/contracts/${id}/compare`}
            className="inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
          >
            <GitCompare size={15} aria-hidden="true" />
            {t('compareCta')}
          </Link>
        </div>
      )}

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
              kind: (f.kind as 'playbook' | 'asymmetry' | 'contradiction' | 'dependency') ?? 'playbook',
              severity: f.severity as 'high' | 'medium' | 'low',
              title: f.title as string,
              reason: f.reason as string,
              evidence: evidenceByFinding.get(f.id as string) ?? [],
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
