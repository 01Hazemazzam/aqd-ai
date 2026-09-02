import { createServerSupabase } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/org/current'
import { embedTexts, toPgVector } from '@/lib/ai/embed'
import { streamGeminiText, aiComplete, AiDisabledError, AiUpstreamError } from '@/lib/ai/router'
import { contractPrompt, condensePrompt, isNotFoundAnswer, repairHebrewArabicHomoglyphs, type ChatTurn } from '@/lib/ai/prompts'
import { needsHistoryContext, recentTurns, acceptCondensed, HISTORY_TURNS, CONDENSE_TIMEOUT_MS } from '@/lib/chat/condense'
import { assembleContractContext, fitsBudget, resolveContractCitations, type ContextClause } from '@/lib/chat/contract-context'
import { contractFactsFor } from '@/lib/chat/render'
import { loadIntelligence } from '@/lib/intelligence/load'
import { supabaseIntelligenceReader } from '@/lib/intelligence/supabase-reader'
import { sseEvent } from '@/lib/chat/sse'

const MATCH_COUNT = 6

export async function POST(request: Request) {
  const { contractId, question } = await request.json()
  if (typeof contractId !== 'string' || typeof question !== 'string' || !question.trim()) {
    return new Response(sseEvent('error', { error: 'invalid_request' }), {
      status: 400,
      headers: { 'content-type': 'text/event-stream' },
    })
  }

  const orgId = await getCurrentOrgId()
  const supabase = await createServerSupabase()

  const { data: contract } = await supabase.from('contracts').select('id').eq('id', contractId).maybeSingle()
  if (!contract) {
    return new Response(sseEvent('error', { error: 'not_found' }), {
      status: 404,
      headers: { 'content-type': 'text/event-stream' },
    })
  }

  let { data: chat } = await supabase.from('chats').select('id').eq('contract_id', contractId).maybeSingle()
  if (!chat) {
    const { data: newChat, error: chatError } = await supabase
      .from('chats')
      .insert({ org_id: orgId, contract_id: contractId })
      .select('id')
      .single()
    if (chatError || !newChat) {
      return new Response(sseEvent('error', { error: 'unknown' }), {
        status: 500,
        headers: { 'content-type': 'text/event-stream' },
      })
    }
    chat = newChat
  }
  const chatId = chat.id as string

  // Read BEFORE inserting this turn, so the history is the conversation the
  // question is a follow-up to and does not contain the question itself.
  // Read from the database rather than accepted from the client: history
  // steers retrieval and reaches the model, so a client-supplied version
  // would be an unauthenticated way to put words in front of it. RLS scopes
  // this to the caller's own org, like every other read here.
  const { data: priorMessages } = await supabase
    .from('chat_messages')
    .select('role, content, not_found')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true })
    .limit(200)

  const history: ChatTurn[] = recentTurns(
    (priorMessages ?? [])
      // A refusal carries no information about what the user meant, and
      // replaying "NOT_FOUND" into the next prompt only invites the model to
      // treat refusal as the house style.
      .filter((m) => !m.not_found)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content as string })),
    HISTORY_TURNS,
  )

  await supabase.from('chat_messages').insert({ chat_id: chatId, org_id: orgId, role: 'user', content: question })

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(new TextEncoder().encode(sseEvent(event, data)))

      try {
        const { data: version } = await supabase
          .from('contract_versions')
          .select('id')
          .eq('contract_id', contractId)
          .order('version_no', { ascending: false })
          .limit(1)
          .maybeSingle()

        const { data: allClauses } = version
          ? await supabase
              .from('clauses')
              .select('id, clause_number, lang, body')
              .eq('version_id', version.id)
              .order('ordinal', { ascending: true })
          : { data: null }

        // Postgres speaks snake_case and the context module speaks camel;
        // the mapping is explicit so a rename on either side is a type error
        // rather than a silently-undefined clause number.
        const toContextClause = (c: Record<string, unknown>): ContextClause => ({
          id: c.id as string,
          clauseNumber: (c.clause_number as string | null) ?? null,
          lang: c.lang as 'ar' | 'en',
          body: c.body as string,
        })

        const clauses = ((allClauses ?? []) as Array<Record<string, unknown>>).map(toContextClause)
        if (clauses.length === 0) {
          await persist('NOT_FOUND', true, [])
          return
        }

        // The whole document when it fits. Top-6 retrieval capped multi-clause
        // reasoning at whatever six chunks an embedding happened to pull, and
        // made NOT_FOUND ambiguous between "the document does not say" and
        // "retrieval missed it".
        let selected = clauses
        let mode: 'full' | 'retrieved' = 'full'

        if (!fitsBudget(clauses)) {
          mode = 'retrieved'
          // Condense runs ONLY here. Its output has only ever fed embedTexts,
          // so on the full-context path it is a race the user waits behind in
          // exchange for nothing at all.
          let searchQuestion = question
          if (needsHistoryContext(question, history)) {
            try {
              const condense = condensePrompt(history, question)
              const rewritten = await Promise.race([
                aiComplete('cheap', condense.system, condense.user).then((r) => r.text),
                new Promise<null>((resolve) => setTimeout(() => resolve(null), CONDENSE_TIMEOUT_MS)),
              ])
              if (rewritten === null) console.info('[chat] condense timed out, using the question as asked')
              else searchQuestion = acceptCondensed(rewritten, question)
            } catch (err) {
              // A failed rewrite must not fail the answer -- retrieving on the
              // user's own words is exactly the previous behaviour.
              console.warn('[chat] condense failed, using the question as asked:', err instanceof Error ? err.message : err)
            }
          }

          const [queryVector] = await embedTexts([searchQuestion])
          const { data: matches } = await supabase.rpc('match_clauses', {
            p_contract_id: contractId,
            p_query_embedding: toPgVector(queryVector),
            p_match_count: MATCH_COUNT,
          })
          selected = ((matches ?? []) as Array<Record<string, unknown>>).map(toContextClause)
          if (selected.length === 0) {
            await persist('NOT_FOUND', true, [])
            return
          }
        }

        // The analysis this contract already has, read through the same loader
        // the Intelligence views use -- so an answer about this contract's
        // risks and deadlines cannot disagree with the page showing them.
        const bundle = await loadIntelligence(supabaseIntelligenceReader(supabase), orgId, new Date())
        const facts = contractFactsFor(bundle, contractId) ?? {
          contractId,
          title: '',
          parties: [],
          effectiveDate: null,
          termLength: null,
          termEnd: null,
          // An unanalysed contract has no extraction to be outdated; saying so
          // would be a coverage warning about work that was never asked for.
          current: true,
        }

        const context = assembleContractContext(
          selected,
          bundle.findings.filter((f) => f.contractId === contractId),
          bundle.intelligence.obligations.filter((o) => o.contractId === contractId),
          facts,
          mode,
        )

        const { system, user } = contractPrompt(question, context.text, mode, history)

        let fullText = ''
        for await (const chunk of streamGeminiText('main', system, user)) {
          fullText += chunk.textDelta
          send('token', { text: chunk.textDelta })
        }

        // Persisted/re-rendered text is repaired even though the live-streamed
        // tokens already reached the client as-is -- see the comment on
        // repairHebrewArabicHomoglyphs for why this is a narrow, targeted fix
        // rather than a token-level one.
        const repairedText = repairHebrewArabicHomoglyphs(fullText)
        const notFound = isNotFoundAnswer(repairedText)
        const content = notFound ? 'NOT_FOUND' : repairedText
        await persist(content, notFound, notFound ? [] : resolveContractCitations(content, context.sources))
      } catch (err) {
        // Previously unlogged entirely -- a real 429 quota exhaustion (the
        // same Google free-tier daily limit already hit by the analysis
        // pipeline, see qa/FINDINGS.md) rendered as "Something went wrong
        // answering that" with zero trace of why, anywhere.
        console.error('[chat] request failed:', err instanceof Error ? err.message : err)
        const errorCode =
          err instanceof AiDisabledError ? 'ai_disabled'
          : err instanceof AiUpstreamError && err.status === 429 ? 'quota_exceeded'
          : err instanceof AiUpstreamError ? 'upstream_failed'
          : 'unknown'
        send('error', { error: errorCode })
        controller.close()
      }

      async function persist(
        content: string,
        notFound: boolean,
        citations: Array<{ ordinal: number; clauseId: string | null; findingId: string | null }>,
      ) {
        const { data: assistantMessage } = await supabase
          .from('chat_messages')
          .insert({ chat_id: chatId, org_id: orgId, role: 'assistant', content, not_found: notFound })
          .select('id')
          .single()

        if (assistantMessage && citations.length) {
          await supabase.from('citations').insert(
            citations.map((c) => ({
              message_id: assistantMessage.id,
              org_id: orgId,
              clause_id: c.clauseId,
              finding_id: c.findingId,
              ordinal: c.ordinal,
            })),
          )
        }

        send('done', { messageId: assistantMessage?.id ?? null, citations, notFound })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  })
}
