import { useTranslations } from 'next-intl'

export default function DashboardPage() {
  const t = useTranslations('common')
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="font-serif text-4xl font-medium tracking-tight text-ink">{t('appName')}</h1>
    </main>
  )
}
