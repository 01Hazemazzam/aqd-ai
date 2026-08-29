import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function DashboardPage() {
  const d = useTranslations('dashboard')
  return (
    <main className="mx-auto max-w-3xl px-6 py-20 sm:px-10">
      <h1 className="font-serif text-4xl font-medium tracking-tight text-ink text-balance">
        {d('welcome')}
      </h1>
      <Card className="mt-10 flex items-start gap-4">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent"
        >
          ✎
        </span>
        <div className="flex-1">
          <p className="text-sm leading-relaxed text-ink-dim">{d('subtitle')}</p>
          <Link href="/contracts" className="mt-4 inline-block">
            <Button type="button" variant="secondary">{d('viewContracts')}</Button>
          </Link>
        </div>
      </Card>
    </main>
  )
}
