// Loading the portfolio conversation back for display.
//
// The server already reads this history to understand follow-ups; if the
// client mounted empty, the assistant would remember a conversation the user
// cannot see -- which reads as a bug even though nothing is broken.
//
// The awkward part is the citation links. A portfolio citation points at a
// clause or a finding, and rendering it needs the CONTRACT to navigate to,
// which neither row carries. So the contract is walked back to:
//
//   clause  -> clauses.version_id -> contract_versions.contract_id
//   finding -> risk_findings.analysis_id -> analyses.contract_id
//
// Done as explicit lookups rather than nested PostgREST embeds: the embed
// syntax for a two-hop join through two different parents is hard to read,
// harder to change, and fails at runtime rather than at compile time.

import type { createServerSupabase } from '@/lib/supabase/server'

type Supabase = Awaited<ReturnType<typeof createServerSupabase>>

export interface HistoryCitation {
  ordinal: number
  contractId: string
  clauseId: string | null
  findingId: string | null
}

export interface HistoryMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: HistoryCitation[]
  notFound: boolean
}

export async function loadPortfolioHistory(supabase: Supabase, notFoundText: string): Promise<HistoryMessage[]> {
  const { data: chat } = await supabase.from('chats').select('id').is('contract_id', null).maybeSingle()
  if (!chat) return []

  const { data: messages } = await supabase
    .from('chat_messages')
    .select('id, role, content, not_found')
    .eq('chat_id', chat.id)
    .order('created_at', { ascending: true })
    .limit(200)

  if (!messages?.length) return []

  const { data: citations } = await supabase
    .from('citations')
    .select('message_id, ordinal, clause_id, finding_id')
    .in(
      'message_id',
      messages.map((m) => m.id),
    )

  const contractByClause = new Map<string, string>()
  const contractByFinding = new Map<string, string>()

  const clauseIds = [...new Set((citations ?? []).map((c) => c.clause_id).filter((id): id is string => id !== null))]
  if (clauseIds.length) {
    const { data: clauses } = await supabase.from('clauses').select('id, version_id').in('id', clauseIds)
    const versionIds = [...new Set((clauses ?? []).map((c) => c.version_id as string))]
    const { data: versions } = versionIds.length
      ? await supabase.from('contract_versions').select('id, contract_id').in('id', versionIds)
      : { data: [] }
    const contractByVersion = new Map((versions ?? []).map((v) => [v.id as string, v.contract_id as string]))
    for (const c of clauses ?? []) {
      const contractId = contractByVersion.get(c.version_id as string)
      if (contractId) contractByClause.set(c.id as string, contractId)
    }
  }

  const findingIds = [...new Set((citations ?? []).map((c) => c.finding_id).filter((id): id is string => id !== null))]
  if (findingIds.length) {
    const { data: findings } = await supabase.from('risk_findings').select('id, analysis_id').in('id', findingIds)
    const analysisIds = [...new Set((findings ?? []).map((f) => f.analysis_id as string))]
    const { data: analyses } = analysisIds.length
      ? await supabase.from('analyses').select('id, contract_id').in('id', analysisIds)
      : { data: [] }
    const contractByAnalysis = new Map((analyses ?? []).map((a) => [a.id as string, a.contract_id as string]))
    for (const f of findings ?? []) {
      const contractId = contractByAnalysis.get(f.analysis_id as string)
      if (contractId) contractByFinding.set(f.id as string, contractId)
    }
  }

  const byMessage = new Map<string, HistoryCitation[]>()
  for (const c of citations ?? []) {
    const clauseId = (c.clause_id as string | null) ?? null
    const findingId = (c.finding_id as string | null) ?? null
    const contractId = clauseId ? contractByClause.get(clauseId) : findingId ? contractByFinding.get(findingId) : undefined
    // A citation whose contract has since been deleted has nowhere to link,
    // so it renders as plain text rather than as a broken link.
    if (!contractId) continue
    const list = byMessage.get(c.message_id as string) ?? []
    list.push({ ordinal: c.ordinal as number, contractId, clauseId, findingId })
    byMessage.set(c.message_id as string, list)
  }

  return messages.map((m) => ({
    id: m.id as string,
    role: m.role as 'user' | 'assistant',
    // The refusal is stored as the bare token and rendered as real prose in
    // the reader's language, exactly as the contract chat does it.
    content: m.not_found ? notFoundText : (m.content as string),
    citations: byMessage.get(m.id as string) ?? [],
    notFound: m.not_found as boolean,
  }))
}
