import { createServerSupabase } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/org/current'
import { embedTexts, toPgVector } from '@/lib/ai/embed'
import { streamGeminiText, aiComplete, AiDisabledError, AiUpstreamError } from '@/lib/ai/router'
import {
  chatPrompt,
  condensePrompt,
  isNotFoundAnswer,
  resolveCitations,
  repairHebrewArabicHomoglyphs,
  type RetrievedClause,
  type ChatTurn,
} from '@/lib/ai/prompts'
import { needsHistoryContext, recentTurns, acceptCondensed, HISTORY_TURNS, CONDENSE_TIMEOUT_MS } from '@/lib/chat/condense'

const MATCH_COUNT = 6

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

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

      const persistAndClose = async (content: string, notFound: boolean, matches: Array<RetrievedClause & { id: string }>) => {
        const { data: assistantMessage } = await supabase
          .from('chat_messages')
          .insert({ chat_id: chatId, org_id: orgId, role: 'assistant', content, not_found: notFound })
          .select('id')
          .single()

        const citations = assistantMessage && !notFound ? resolveCitations(content, matches) : []
        if (citations.length) {
          await supabase.from('citations').insert(
            citations.map((c) => ({
              message_id: assistantMessage!.id,
              org_id: orgId,
              clause_id: c.clauseId,
              ordinal: c.ordinal,
            })),
          )
        }

        send('done', { messageId: assistantMessage?.id ?? null, citations, notFound })
        controller.close()
      }

      try {
        // What gets embedded is the question as it would have been asked
        // standalone. "And for the provider?" retrieves nothing on its own
        // words; rewritten against the conversation it retrieves the clause
        // the user actually means.
        let searchQuestion = question
        if (needsHistoryContext(question, history)) {
          try {
            const condense = condensePrompt(history, question)
            // Raced against a deadline: a rewrite that arrives late has
            // already cost the user more than the better retrieval is worth.
            // The losing call is left to settle on its own rather than
            // aborted -- it is a read with no side effects.
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
        const retrieved = (matches ?? []) as Array<{ id: string; clause_number: string | null; lang: 'ar' | 'en'; body: string }>

        if (retrieved.length === 0) {
          await persistAndClose('NOT_FOUND', true, [])
          return
        }

        const promptClauses: RetrievedClause[] = retrieved.map((m) => ({ clauseNumber: m.clause_number, lang: m.lang, body: m.body }))
        // The model answers the question the user actually typed, with the
        // conversation for reference. The rewrite is a retrieval aid only --
        // answering the rewrite instead would let a distorted paraphrase
        // silently replace the user's question.
        const { system, user } = chatPrompt(question, promptClauses, history)

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
        const matchesWithId = retrieved.map((m) => ({ id: m.id, clauseNumber: m.clause_number, lang: m.lang, body: m.body }))
        await persistAndClose(notFound ? 'NOT_FOUND' : repairedText, notFound, matchesWithId)
      } catch (err) {
        // Previously unlogged entirely -- a real 429 quota exhaustion (the
        // same Google free-tier daily limit already hit by the analysis
        // pipeline, see qa/FINDINGS.md) rendered as "Something went wrong
        // answering that" with zero trace of why, anywhere. Logged here the
        // same way analyze-actions.ts's runTask logs a task failure.
        console.error('[chat] request failed:', err instanceof Error ? err.message : err)
        const errorCode =
          err instanceof AiDisabledError ? 'ai_disabled'
          : err instanceof AiUpstreamError && err.status === 429 ? 'quota_exceeded'
          : err instanceof AiUpstreamError ? 'upstream_failed'
          : 'unknown'
        send('error', { error: errorCode })
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
