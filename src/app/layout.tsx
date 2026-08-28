import './globals.css'
import type { Metadata } from 'next'
import { ThemeProvider } from '@/components/theme-provider'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'
import { dirFor, type Locale } from '@/lib/i18n/config'

// A non-empty <title> is a WCAG 2.4.2 / axe "document-title" requirement,
// caught by e2e/a11y.spec.ts -- every page needs one, so it lives here
// rather than duplicated per (client-component) auth page.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common')
  return { title: t('appName') }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = (await getLocale()) as Locale
  const messages = await getMessages()
  return (
    <html lang={locale} dir={dirFor(locale)} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=Inter:wght@400;500;600;700&family=Amiri:wght@400;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600&family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Aref+Ruqaa:wght@400;700&display=swap"
        />
      </head>
      <body className="bg-surface text-ink antialiased">
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider>{children}</ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
