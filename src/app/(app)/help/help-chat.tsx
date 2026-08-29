'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Bot, Send, MessageSquare } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { askProductHelper } from './actions'

interface Message {
  role: 'user' | 'assistant'
  content: string
  errorKey?: string
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

export function HelpChat() {
  const t = useTranslations('help')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [pending, startTransition] = useTransition()
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, pending])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const question = input.trim()
    if (!question || pending) return

    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: question }])

    startTransition(async () => {
      const result = await askProductHelper(question)
      setMessages((prev) => [
        ...prev,
        result.error
          ? { role: 'assistant', content: '', errorKey: result.error }
          : { role: 'assistant', content: result.answer ?? '' },
      ])
    })
  }

  return (
    <Card>
      <div ref={listRef} className="mb-4 flex max-h-[28rem] flex-col gap-3 overflow-y-auto scroll-smooth">
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <MessageSquare size={20} aria-hidden="true" className="text-ink-faint" />
            <p className="max-w-xs text-sm text-ink-faint">{t('empty')}</p>
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
                  <span role="alert" className="text-risk-high">{t(`errors.${m.errorKey}` as 'errors.unknown')}</span>
                ) : (
                  m.content
                )}
              </div>
            </motion.div>
          ))}
          {pending && (
            <motion.div
              key="pending"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex max-w-[85%] items-center gap-1.5 rounded-lg bg-surface-3 px-3 py-2 text-ink-dim"
            >
              <Bot size={13} aria-hidden="true" className="shrink-0" />
              <TypingIndicator />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('placeholder')}
          disabled={pending}
          className="flex-1 rounded-lg border border-edge bg-surface p-2 text-sm text-ink placeholder:text-ink-faint transition-colors focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
        />
        <Button type="submit" loading={pending} disabled={!input.trim()} icon={<Send size={14} aria-hidden="true" />}>
          {t('send')}
        </Button>
      </form>
    </Card>
  )
}
