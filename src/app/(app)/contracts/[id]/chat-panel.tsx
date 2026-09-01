'use client'
import { useTranslations } from 'next-intl'
import { Sparkles } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { ChatWidget, type ChatMessage, type ChatTransport, type Delta } from '@/components/chat-widget'

export interface Citation {
  ordinal: number
  clauseId: string
  clauseNumber: string | null
}

// The surface-specific fields Contract chat adds on top of the widget's base
// message. citations drives the clickable [n] rendering; notFound marks the
// grounded-refusal answer.
export type ContractChatExtra = { citations?: Citation[]; notFound?: boolean }
export type ContractChatMessage = ChatMessage<ContractChatExtra>

function scrollToAndFlashClause(clauseId: string) {
  const el = document.getElementById(`clause-${clauseId}`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.remove('clause-flash')
  // Force a reflow so re-adding the class replays the animation even if
  // the same clause was just flashed a moment ago.
  void el.offsetWidth
  el.classList.add('clause-flash')
}

// Splits "See [1] and [2]." into text/citation parts so citation numbers can
// render as clickable spans without touching the rest of the sentence.
function renderWithCitations(content: string, citations: Citation[]) {
  const byOrdinal = new Map(citations.map((c) => [c.ordinal, c]))
  const parts = content.split(/(\[\d+\])/g)
  return parts.map((part, i) => {
    const match = part.match(/^\[(\d+)\]$/)
    const citation = match ? byOrdinal.get(Number(match[1])) : undefined
    if (!citation) return <span key={i}>{part}</span>
    return (
      <button
        key={i}
        type="button"
        onClick={() => scrollToAndFlashClause(citation.clauseId)}
        className="mx-0.5 rounded bg-brass/15 px-1 font-medium text-brass transition-colors hover:bg-brass/25 hover:underline"
      >
        {part}
      </button>
    )
  })
}

// The Contract-chat transport adapter: turns the /api/chat SSE stream into the
// widget's Delta shape. All SSE-parsing, the contractId, and the NOT_FOUND
// text substitution live here, behind the send() seam -- the widget never
// learns any of them. See docs/adr/0001-chat-transport-as-async-generator.md.
async function* streamContractChat(
  contractId: string,
  notFoundText: string,
  question: string,
  signal: AbortSignal,
): AsyncIterable<Delta<ContractChatExtra>> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contractId, question }),
    signal,
  })
  if (!response.body) throw new Error('no response body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const eventLine = frame.split('\n').find((l) => l.startsWith('event:'))
      const dataLine = frame.split('\n').find((l) => l.startsWith('data:'))
      if (!eventLine || !dataLine) continue
      const event = eventLine.slice(6).trim()
      const data = JSON.parse(dataLine.slice(5).trim())

      if (event === 'token') {
        yield { type: 'append', text: data.text }
      } else if (event === 'done') {
        yield {
          type: 'finalize',
          patch: data.notFound
            ? { content: notFoundText, notFound: true, citations: [] }
            : { notFound: false, citations: data.citations },
        }
      } else if (event === 'error') {
        yield { type: 'error', errorKey: data.error }
      }
    }
  }
}

// initialMessages is fetched server-side by the contract page and handed in
// here so a reload shows real history immediately -- previously ChatPanel
// always mounted with an empty list, so existing chat_messages/citations
// were fully intact in the database but never loaded back into view (see
// qa/FINDINGS.md, Sub-project 4's third QA pass).
export function ChatPanel({
  contractId,
  initialMessages = [],
}: {
  contractId: string
  initialMessages?: ContractChatMessage[]
}) {
  const t = useTranslations('contracts')

  const send: ChatTransport<ContractChatExtra> = (question, { signal }) =>
    streamContractChat(contractId, t('chat.notFound'), question, signal)

  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
        <Sparkles size={15} aria-hidden="true" className="text-accent" />
        {t('chat.title')}
      </h2>
      <ChatWidget<ContractChatExtra>
        send={send}
        renderContent={(m) => (m.citations ? renderWithCitations(m.content, m.citations) : m.content)}
        initialMessages={initialMessages}
        emptyText={t('chat.empty')}
        placeholder={t('chat.placeholder')}
        sendLabel={t('chat.send')}
        errorText={(key) => t(`chat.errors.${key}` as 'chat.errors.unknown')}
      />
    </Card>
  )
}
