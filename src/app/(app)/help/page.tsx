import { getTranslations } from 'next-intl/server'
import { HelpChat } from './help-chat'

// The deployment target kills a function at 60s. Declared explicitly rather
// than left to the platform default (10s), which is shorter than a healthy
// analysis. The AI retry budget in lib/ai/router.ts is sized to fit inside
// this with room for the database writes that follow -- change one and check
// the other.
export const maxDuration = 60

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
