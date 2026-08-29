'use client'
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { askProductHelper } from './actions'

interface Message {
  role: 'user' | 'assistant'
  content: string
  errorKey?: string
}

export function HelpChat() {
  const t = useTranslations('help')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [pending, startTransition] = useTransition()

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
      <div className="mb-4 flex max-h-[28rem] flex-col gap-3 overflow-y-auto">
        {messages.length === 0 && <p className="text-sm text-ink-faint">{t('empty')}</p>}
        {messages.map((m, i) => (
          <div key={i} dir="auto" className={m.role === 'user' ? 'ms-auto max-w-[85%]' : 'max-w-[85%]'}>
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
          </div>
        ))}
        {pending && <p className="text-sm text-ink-faint">{t('thinking')}</p>}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('placeholder')}
          disabled={pending}
          className="flex-1 rounded-lg border border-edge bg-surface p-2 text-sm text-ink placeholder:text-ink-faint disabled:opacity-50"
        />
        <Button type="submit" loading={pending} disabled={!input.trim()}>{t('send')}</Button>
      </form>
    </Card>
  )
}
