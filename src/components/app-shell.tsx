import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/org/current'
import { signOut } from '@/lib/auth/sign-out'
import { SettingsToggles } from '@/components/settings-toggles'
import { Button } from '@/components/ui/button'

const NAV_LINKS = [
  { href: '/contracts', key: 'contracts' },
  { href: '/settings/team', key: 'team' },
  { href: '/settings/security', key: 'security' },
] as const

// Server component: renders once per navigation with a fresh org-name read,
// same cost as any other (app) page's own data fetch. No client-side nav
// state to keep in sync with the URL.
export async function AppShell({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('common')
  const orgId = await getCurrentOrgId()
  const supabase = await createServerSupabase()
  const { data: org } = await supabase.from('organizations').select('name').eq('id', orgId).maybeSingle()

  return (
    <div className="min-h-dvh bg-surface">
      <header className="border-b border-edge bg-surface-2">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3 sm:px-10">
          <div className="flex items-center gap-6">
            <Link href="/" className="font-wordmark text-lg font-semibold tracking-tight text-ink">
              {t('appName')}
            </Link>
            <nav className="flex items-center gap-1">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-dim transition-colors hover:bg-surface-3 hover:text-ink"
                >
                  {t(`nav.${link.key}`)}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {org?.name && <span className="hidden text-sm text-ink-faint sm:inline">{org.name}</span>}
            <SettingsToggles />
            <form action={signOut}>
              <Button type="submit" variant="ghost" className="px-2.5">{t('nav.signOut')}</Button>
            </form>
          </div>
        </div>
      </header>
      {children}
    </div>
  )
}
