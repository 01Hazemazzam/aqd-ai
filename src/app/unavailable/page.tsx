import { getTranslations } from 'next-intl/server'
import { CloudOff } from 'lucide-react'

/**
 * Shown when the database could not be reached at all.
 *
 * Outside the (app) group on purpose: it must render with no session, no org
 * lookup and no query, because the one condition it exists for is that none
 * of those work. It reads its strings from the locale cookie, which is the
 * only state it touches.
 */
export default async function UnavailablePage() {
  const t = await getTranslations('unavailable')
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-3 text-ink-faint">
        <CloudOff size={22} />
      </span>
      <h1 className="font-serif text-2xl text-ink">{t('title')}</h1>
      <p className="text-sm leading-relaxed text-ink-dim">{t('body')}</p>
      <p className="text-xs text-ink-faint">{t('hint')}</p>
    </main>
  )
}
