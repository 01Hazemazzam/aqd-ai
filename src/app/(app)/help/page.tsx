import { getTranslations } from 'next-intl/server'
import { HelpChat } from './help-chat'

export default async function HelpPage() {
  const t = await getTranslations('help')
  return (
    <main className="mx-auto max-w-3xl px-6 py-20 sm:px-10">
      <h1 className="mb-2 font-serif text-3xl font-medium tracking-tight text-ink text-balance">{t('title')}</h1>
      <p className="mb-8 text-sm text-ink-dim">{t('subtitle')}</p>
      <HelpChat />
    </main>
  )
}
