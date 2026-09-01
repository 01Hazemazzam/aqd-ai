'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Send, MessageSquare } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Button } from '@/components/ui/button'

// The base message every surface shares. `Extra` carries surface-specific
// fields (Contract chat adds citations/notFound); the Product helper adds
// nothing. renderContent, when supplied, receives the full ChatMessage<Extra>
// so a surface can interpret its own extra fields without the widget knowing
// they exist.
export type ChatMessage<Extra = unknown> = {
  role: 'user' | 'assistant'
  content: string
  errorKey?: string
} & Extra

// The one shape both transports speak. A streaming transport yields many
// `append`s then one `finalize`; a one-shot transport yields a single
// `finalize` (or `error`). See docs/adr/0001-chat-transport-as-async-generator.md.
export type Delta<Extra = unknown> =
  | { type: 'append'; text: string }
  | { type: 'finalize'; patch?: Partial<ChatMessage<Extra>> }
  | { type: 'error'; errorKey: string }

export type ChatTransport<Extra = unknown> = (
  question: string,
  options: { signal: AbortSignal },
) => AsyncIterable<Delta<Extra>>

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

export function ChatWidget<Extra = unknown>({
  send,
  renderContent,
  initialMessages = [],
  emptyText,
  placeholder,
  sendLabel,
  errorText,
}: {
  send: ChatTransport<Extra>
  renderContent?: (message: ChatMessage<Extra>) => ReactNode
  initialMessages?: ChatMessage<Extra>[]
  emptyText: string
  placeholder: string
  sendLabel: string
  errorText: (errorKey: string) => string
}) {
  const [messages, setMessages] = useState<ChatMessage<Extra>[]>(initialMessages)
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // Owning the transport lifecycle means owning its teardown: abort any
  // in-flight stream when the widget unmounts, so deltas never land on an
  // unmounted component and a streaming fetch doesn't keep running.
  useEffect(() => () => abortRef.current?.abort(), [])

  // Mutates the last (assistant) message in place -- the placeholder appended
  // on submit. Every delta and the catch clause funnel through here.
  function patchLast(patch: Partial<ChatMessage<Extra>>) {
    setMessages((prev) => {
      const next = [...prev]
      next[next.length - 1] = { ...next[next.length - 1], ...patch }
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const question = input.trim()
    if (!question || pending) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setInput('')
    setPending(true)
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: question } as ChatMessage<Extra>,
      { role: 'assistant', content: '' } as ChatMessage<Extra>,
    ])

    try {
      for await (const delta of send(question, { signal: controller.signal })) {
        if (controller.signal.aborted) return
        if (delta.type === 'append') {
          setMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            next[next.length - 1] = { ...last, content: last.content + delta.text }
            return next
          })
        } else if (delta.type === 'finalize') {
          if (delta.patch) patchLast(delta.patch)
        } else {
          patchLast({ errorKey: delta.errorKey } as Partial<ChatMessage<Extra>>)
        }
      }
    } catch {
      if (!controller.signal.aborted) {
        patchLast({ errorKey: 'unknown' } as Partial<ChatMessage<Extra>>)
      }
    } finally {
      if (!controller.signal.aborted) setPending(false)
    }
  }

  return (
    <>
      <div ref={listRef} className="mb-4 flex max-h-[28rem] flex-col gap-3 overflow-y-auto scroll-smooth">
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <MessageSquare size={20} aria-hidden="true" className="text-ink-faint" />
            <p className="max-w-xs text-sm text-ink-faint">{emptyText}</p>
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
                  <span role="alert" className="text-risk-high">{errorText(m.errorKey)}</span>
                ) : m.content === '' && pending && i === messages.length - 1 ? (
                  <TypingIndicator />
                ) : renderContent ? (
                  renderContent(m)
                ) : (
                  m.content
                )}
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
          placeholder={placeholder}
          disabled={pending}
          className="flex-1 rounded-lg border border-edge bg-surface p-2 text-sm text-ink placeholder:text-ink-faint transition-colors focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
        />
        <Button type="submit" loading={pending} disabled={!input.trim()} icon={<Send size={14} aria-hidden="true" />}>
          {sendLabel}
        </Button>
      </form>
    </>
  )
}
