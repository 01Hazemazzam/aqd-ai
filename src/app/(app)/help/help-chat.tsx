'use client'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/card'
import { ChatWidget, type ChatTransport, type Delta } from '@/components/chat-widget'
import { askProductHelper } from './actions'

// The Product-helper transport adapter: a one-shot server action expressed as
// a generator that yields exactly one delta. The signal is unused -- a server
// action can't be cancelled client-side -- but the widget still drops the
// delta if it resolves after unmount. See
// docs/adr/0001-chat-transport-as-async-generator.md.
async function* askProductHelperStream(question: string): AsyncIterable<Delta> {
  const result = await askProductHelper(question)
  if (result.error) {
    yield { type: 'error', errorKey: result.error }
  } else {
    yield { type: 'finalize', patch: { content: result.answer ?? '' } }
  }
}

export function HelpChat() {
  const t = useTranslations('help')

  const send: ChatTransport = (question) => askProductHelperStream(question)

  return (
    <Card>
      <ChatWidget
        send={send}
        emptyText={t('empty')}
        placeholder={t('placeholder')}
        sendLabel={t('send')}
        errorText={(key) => t(`errors.${key}` as 'errors.unknown')}
      />
    </Card>
  )
}
