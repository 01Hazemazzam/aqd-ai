'use client'
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Sparkles, Send, MessageSquare } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export interface Citation {
  ordinal: number
  clauseId: string
  clauseNumber: string | null
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  notFound?: boolean
  citations?: Citation[]
  errorKey?: string
}

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

function TypingIndicator() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint"
          style={{ animationDelay: `${i * 120}ms`, animationDuration: '900ms' }}
        />
      ))}
    </span>
  )
}

// initialMessages is fetched server-side by the contract page and handed in
// here so a reload shows real history immediately -- previously ChatPanel
// always mounted with an empty list, so existing chat_messages/citations
// were fully intact in the database but never loaded back into view (see
// qa/FINDINGS.md, Sub-project 4's third QA pass).
export function ChatPanel({ contractId, initialMessages = [] }: { contractId: string; initialMessages?: ChatMessage[] }) {
  const t = useTranslations('contracts')
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const question = input.trim()
    if (!question || pending) return

    setInput('')
    setPending(true)
    setMessages((prev) => [...prev, { role: 'user', content: question }, { role: 'assistant', content: '' }])

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contractId, question }),
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
            setMessages((prev) => {
              const next = [...prev]
              next[next.length - 1] = { ...next[next.length - 1], content: next[next.length - 1].content + data.text }
              return next
            })
          } else if (event === 'done') {
            setMessages((prev) => {
              const next = [...prev]
              const last = next[next.length - 1]
              next[next.length - 1] = {
                ...last,
                content: data.notFound ? t('chat.notFound') : last.content,
                notFound: data.notFound,
                citations: data.citations,
              }
              return next
            })
          } else if (event === 'error') {
            setMessages((prev) => {
              const next = [...prev]
              next[next.length - 1] = { ...next[next.length - 1], errorKey: data.error }
              return next
            })
          }
        }
      }
    } catch {
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = { ...next[next.length - 1], errorKey: 'unknown' }
        return next
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
        <Sparkles size={15} aria-hidden="true" className="text-accent" />
        {t('chat.title')}
      </h2>

      <div ref={listRef} className="mb-4 flex max-h-96 flex-col gap-3 overflow-y-auto scroll-smooth">
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <MessageSquare size={20} aria-hidden="true" className="text-ink-faint" />
            <p className="max-w-xs text-sm text-ink-faint">{t('chat.empty')}</p>
          </div>
        )}
        <AnimatePresence initial={false}>
          {messages.map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              dir="auto"
              className={m.role === 'user' ? 'ms-auto max-w-[85%]' : 'max-w-[85%]'}
            >
              <div
                className={
                  m.role === 'user'
                    ? 'rounded-lg bg-accent/10 px-3 py-2 text-sm text-ink'
                    : 'rounded-lg bg-surface-3 px-3 py-2 text-sm text-ink-dim'
                }
              >
                {m.errorKey ? (
                  <span role="alert" className="text-risk-high">{t(`chat.errors.${m.errorKey}` as 'chat.errors.unknown')}</span>
                ) : m.citations ? (
                  renderWithCitations(m.content, m.citations)
                ) : m.content ? (
                  m.content
                ) : pending && i === messages.length - 1 ? (
                  <TypingIndicator />
                ) : null}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('chat.placeholder')}
          disabled={pending}
          className="flex-1 rounded-lg border border-edge bg-surface p-2 text-sm text-ink placeholder:text-ink-faint transition-colors focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
        />
        <Button type="submit" loading={pending} disabled={!input.trim()} icon={<Send size={14} aria-hidden="true" />}>
          {t('chat.send')}
        </Button>
      </form>
    </Card>
  )
}
