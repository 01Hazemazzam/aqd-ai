import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/card'

export default function DashboardPage() {
  const t = useTranslations('common')
  const d = useTranslations('dashboard')
  return (
    <main className="mx-auto max-w-3xl px-6 py-20 sm:px-10">
      <span className="text-sm font-medium tracking-wide text-ink-faint">{t('appName')}</span>
      <h1 className="mt-2 font-serif text-4xl font-medium tracking-tight text-ink text-balance">
        {d('welcome')}
      </h1>
      <Card className="mt-10 flex items-start gap-4">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent"
        >
          ✎
        </span>
        <p className="text-sm leading-relaxed text-ink-dim">{d('subtitle')}</p>
      </Card>
    </main>
  )
}
