import { createServerSupabase } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/org/current'
import { embedTexts, toPgVector } from '@/lib/ai/embed'
import { streamGeminiText, AiDisabledError, AiUpstreamError } from '@/lib/ai/router'
import { chatPrompt, isNotFoundAnswer, resolveCitations, type RetrievedClause } from '@/lib/ai/prompts'

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
        const [queryVector] = await embedTexts([question])
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
        const { system, user } = chatPrompt(question, promptClauses)

        let fullText = ''
        for await (const chunk of streamGeminiText('main', system, user)) {
          fullText += chunk.textDelta
          send('token', { text: chunk.textDelta })
        }

        const notFound = isNotFoundAnswer(fullText)
        const matchesWithId = retrieved.map((m) => ({ id: m.id, clauseNumber: m.clause_number, lang: m.lang, body: m.body }))
        await persistAndClose(notFound ? 'NOT_FOUND' : fullText, notFound, matchesWithId)
      } catch (err) {
        const errorCode = err instanceof AiDisabledError ? 'ai_disabled' : err instanceof AiUpstreamError ? 'upstream_failed' : 'unknown'
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
