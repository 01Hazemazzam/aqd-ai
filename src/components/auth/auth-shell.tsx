import { useTranslations } from 'next-intl'
import { BrandPanel } from './brand-panel'

export function AuthShell({ title, subtitle, children }: {
  title: string; subtitle: string; children: React.ReactNode
}) {
  const c = useTranslations('common')

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col px-6 py-10 sm:px-10">
        <span className="font-serif text-lg font-medium tracking-tight text-ink">{c('appName')}</span>
        <div className="flex flex-1 items-center justify-center py-8">
          <div className="w-full max-w-sm">
            <h1 className="mb-2 font-serif text-3xl font-medium tracking-tight text-ink">{title}</h1>
            <p className="mb-8 text-sm text-ink-dim">{subtitle}</p>
            {children}
          </div>
        </div>
      </div>
      <BrandPanel />
    </div>
  )
}
