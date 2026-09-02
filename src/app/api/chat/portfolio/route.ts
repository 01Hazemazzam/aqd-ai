import { createServerSupabase } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/org/current'
import { streamGeminiText, AiDisabledError, AiUpstreamError } from '@/lib/ai/router'
import { portfolioPrompt, isNotFoundAnswer, repairHebrewArabicHomoglyphs, type ChatTurn } from '@/lib/ai/prompts'
import { recentTurns, HISTORY_TURNS } from '@/lib/chat/condense'
import { loadIntelligence } from '@/lib/intelligence/load'
import { supabaseIntelligenceReader } from '@/lib/intelligence/supabase-reader'
import { assemblePortfolioContext, resolvePortfolioCitations } from '@/lib/chat/portfolio-context'
import { sseEvent } from '@/lib/chat/sse'

// The deployment target kills a function at 60s. Declared explicitly rather
// than left to the platform default (10s), which is shorter than a healthy
// analysis. The AI retry budget in lib/ai/router.ts is sized to fit inside
// this with room for the database writes that follow -- change one and check
// the other.
export const maxDuration = 60

// Portfolio scope: the Intelligence assistant.
//
// A separate route from /api/chat, not a mode of it. The two scopes retrieve
// nothing in common, prompt differently, cite differently and fail
// differently, so the only thing a shared route would share is the SSE
// plumbing -- which is four lines and now lives in lib/chat/sse.
//
// Notably absent: the condense step. It exists to rewrite a follow-up into
// something that EMBEDS well, and its output has only ever fed embedTexts.
// Nothing is embedded here -- the whole portfolio is assembled directly --
// so running it would be up to a four-second race the user waits behind in
// exchange for nothing at all.

export async function POST(request: Request) {
  const { question } = await request.json()
  if (typeof question !== 'string' || !question.trim()) {
    return new Response(sseEvent('error', { error: 'invalid_request' }), {
      status: 400,
      headers: { 'content-type': 'text/event-stream' },
    })
  }

  const orgId = await getCurrentOrgId()
  const supabase = await createServerSupabase()

  // The portfolio conversation is the one whose contract_id is null. The
  // partial unique index in 0019 makes that at most one row per org.
  let { data: chat } = await supabase.from('chats').select('id').is('contract_id', null).maybeSingle()
  if (!chat) {
    const { data: newChat, error } = await supabase.from('chats').insert({ org_id: orgId, contract_id: null }).select('id').single()
    if (error || !newChat) {
      return new Response(sseEvent('error', { error: 'unknown' }), { status: 500, headers: { 'content-type': 'text/event-stream' } })
    }
    chat = newChat
  }
  const chatId = chat.id as string

  // Read before inserting this turn, so the history is what the question is a
  // follow-up to. From the database rather than from the client: history
  // reaches the model, and accepting a client copy would be an unauthenticated
  // way to put words in front of it.
  const { data: priorMessages } = await supabase
    .from('chat_messages')
    .select('role, content, not_found')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true })
    .limit(200)

  const history: ChatTurn[] = recentTurns(
    (priorMessages ?? [])
      .filter((m) => !m.not_found)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content as string })),
    HISTORY_TURNS,
  )

  await supabase.from('chat_messages').insert({ chat_id: chatId, org_id: orgId, role: 'user', content: question })

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(new TextEncoder().encode(sseEvent(event, data)))

      try {
        const bundle = await loadIntelligence(supabaseIntelligenceReader(supabase), orgId, new Date())
        const context = assemblePortfolioContext(bundle)

        // NOT_FOUND here means "there is no intelligence layer to answer
        // from", which is true only when nothing has been analysed. An empty
        // RESULT -- no overdue items, nothing due this month -- is a real
        // answer and is left to the model to give plainly; collapsing the two
        // would make "nothing is overdue" indistinguishable from "I cannot
        // tell you", which is the worst possible confusion for an assistant
        // whose silence is supposed to be trustworthy.
        if (bundle.intelligence.contracts.length === 0) {
          const { data: message } = await supabase
            .from('chat_messages')
            .insert({ chat_id: chatId, org_id: orgId, role: 'assistant', content: 'NOT_FOUND', not_found: true })
            .select('id')
            .single()
          send('done', { messageId: message?.id ?? null, citations: [], notFound: true })
          controller.close()
          return
        }

        const { system, user } = portfolioPrompt(question, context.text, history)

        let fullText = ''
        for await (const chunk of streamGeminiText('main', system, user)) {
          fullText += chunk.textDelta
          send('token', { text: chunk.textDelta })
        }

        const repaired = repairHebrewArabicHomoglyphs(fullText)
        const notFound = isNotFoundAnswer(repaired)
        const content = notFound ? 'NOT_FOUND' : repaired

        const { data: message } = await supabase
          .from('chat_messages')
          .insert({ chat_id: chatId, org_id: orgId, role: 'assistant', content, not_found: notFound })
          .select('id')
          .single()

        const citations = message && !notFound ? resolvePortfolioCitations(content, context.sources) : []
        if (citations.length) {
          await supabase.from('citations').insert(
            citations.map((c) => ({
              message_id: message!.id,
              org_id: orgId,
              clause_id: c.clauseId,
              finding_id: c.findingId,
              ordinal: c.ordinal,
            })),
          )
        }

        send('done', { messageId: message?.id ?? null, citations, notFound })
        controller.close()
      } catch (err) {
        console.error('[chat/portfolio] request failed:', err instanceof Error ? err.message : err)
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
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' },
  })
}
