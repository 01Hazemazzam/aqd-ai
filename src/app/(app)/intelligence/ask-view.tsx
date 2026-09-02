'use client'
import Link from 'next/link'
import { ChatWidget, type ChatMessage, type ChatTransport, type Delta } from '@/components/chat-widget'
import { readSseFrames } from '@/lib/chat/sse-client'

// Portfolio scope: the Intelligence assistant's surface.
//
// A fifth view rather than a panel beside the others, and deliberately NOT
// folded into the global product helper. The helper's guarantee is that it
// holds no user data at all -- it is safe by construction, not by prompt --
// and giving it a scope switch would destroy the one property that makes it
// safe to answer with.
//
// Its citations differ from Contract chat's in one way that matters: they
// point into OTHER contracts, so clicking one navigates rather than scrolling
// the current document. A finding about a clause the contract does not have
// lands on the contract itself, since there is no clause to scroll to.

export interface PortfolioCitation {
  ordinal: number
  contractId: string
  clauseId: string | null
  findingId: string | null
}

export type PortfolioChatExtra = { citations?: PortfolioCitation[]; notFound?: boolean }
export type PortfolioChatMessage = ChatMessage<PortfolioChatExtra>

function href(citation: PortfolioCitation): string {
  return citation.clauseId ? `/contracts/${citation.contractId}#clause-${citation.clauseId}` : `/contracts/${citation.contractId}`
}

function renderWithCitations(content: string, citations: PortfolioCitation[]) {
  const byOrdinal = new Map(citations.map((c) => [c.ordinal, c]))
  return content.split(/(\[\d+\])/g).map((part, i) => {
    const match = part.match(/^\[(\d+)\]$/)
    const citation = match ? byOrdinal.get(Number(match[1])) : undefined
    if (!citation) return <span key={i}>{part}</span>
    return (
      <Link
        key={i}
        href={href(citation)}
        className="mx-0.5 rounded bg-brass/15 px-1 font-medium text-brass transition-colors hover:bg-brass/25 hover:underline"
      >
        {part}
      </Link>
    )
  })
}

async function* streamPortfolioChat(notFoundText: string, question: string, signal: AbortSignal): AsyncIterable<Delta<PortfolioChatExtra>> {
  const response = await fetch('/api/chat/portfolio', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question }),
    signal,
  })

  for await (const { event, data } of readSseFrames(response)) {
    if (event === 'token') {
      yield { type: 'append', text: data.text as string }
    } else if (event === 'done') {
      yield {
        type: 'finalize',
        patch: data.notFound
          ? { content: notFoundText, notFound: true, citations: [] }
          : { notFound: false, citations: data.citations as PortfolioCitation[] },
      }
    } else if (event === 'error') {
      yield { type: 'error', errorKey: data.error as string }
    }
  }
}

export interface AskStrings {
  empty: string
  placeholder: string
  send: string
  notFound: string
  errors: Record<string, string>
}

export function AskView({ strings, initialMessages = [] }: { strings: AskStrings; initialMessages?: PortfolioChatMessage[] }) {
  const send: ChatTransport<PortfolioChatExtra> = (question, { signal }) => streamPortfolioChat(strings.notFound, question, signal)

  return (
    <div className="rounded-xl border border-edge bg-surface p-4 sm:p-5">
      <ChatWidget<PortfolioChatExtra>
        send={send}
        renderContent={(m) => (m.citations ? renderWithCitations(m.content, m.citations) : m.content)}
        initialMessages={initialMessages}
        emptyText={strings.empty}
        placeholder={strings.placeholder}
        sendLabel={strings.send}
        errorText={(key) => strings.errors[key] ?? strings.errors.unknown}
      />
    </div>
  )
}
