'use client'
import { useEffect, useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/components/theme-provider'
import { setLocale } from '@/app/actions/locale'
import { cn } from '@/components/ui/cn'
import type { Locale } from '@/lib/i18n/config'

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  )
}

const BUTTON = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-edge bg-surface-2 px-2.5 text-xs font-medium text-ink-dim transition-colors hover:bg-surface-3 hover:text-ink'

export function SettingsToggles({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const locale = useLocale() as Locale
  const t = useTranslations('common')
  const router = useRouter()
  const [, startTransition] = useTransition()

  // 'system' has no fixed value to flip, so resolve it against the OS at click
  // time. This can only be read after mount, hence the effect rather than an
  // initial state -- the server has no way to know the visitor's preference.
  const [isDark, setIsDark] = useState(false)
  useEffect(() => {
    setIsDark(
      theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
        : theme === 'dark',
    )
  }, [theme])

  const nextLocale: Locale = locale === 'ar' ? 'en' : 'ar'

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <button
        type="button"
        onClick={() => setTheme(isDark ? 'light' : 'dark')}
        aria-label={isDark ? t('themeToLight') : t('themeToDark')}
        className={BUTTON}
      >
        {isDark ? <SunIcon /> : <MoonIcon />}
      </button>
      <button
        type="button"
        // The cookie is read server-side to pick the locale and text direction,
        // so the tree has to be re-rendered from the server to pick it up.
        onClick={() =>
          startTransition(async () => {
            await setLocale(nextLocale)
            router.refresh()
          })
        }
        aria-label={t('switchLanguage')}
        lang={nextLocale}
        className={BUTTON}
      >
        {nextLocale === 'ar' ? 'العربية' : 'English'}
      </button>
    </div>
  )
}
