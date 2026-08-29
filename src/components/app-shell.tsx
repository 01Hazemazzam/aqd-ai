import { getTranslations } from 'next-intl/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/org/current'
import { signOut } from '@/lib/auth/sign-out'
import { NavHeader, type NavLink } from '@/components/nav-header'

const NAV_LINKS = [
  { href: '/contracts', key: 'contracts' },
  { href: '/help', key: 'help' },
  { href: '/settings/team', key: 'team' },
  { href: '/settings/security', key: 'security' },
] as const

// Server component: renders once per navigation with a fresh org-name read,
// same cost as any other (app) page's own data fetch. No client-side nav
// state to keep in sync with the URL. The mobile-menu open/close state lives
// in NavHeader (a client component) since that's the only genuinely
// interactive part of the shell.
export async function AppShell({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('common')
  const orgId = await getCurrentOrgId()
  const supabase = await createServerSupabase()
  const { data: org } = await supabase.from('organizations').select('name').eq('id', orgId).maybeSingle()

  const links: NavLink[] = NAV_LINKS.map((link) => ({ ...link, label: t(`nav.${link.key}`) }))

  return (
    <div className="min-h-dvh bg-surface">
      <NavHeader
        appName={t('appName')}
        orgName={org?.name}
        links={links}
        signOutLabel={t('nav.signOut')}
        signOutAction={signOut}
        openMenuLabel={t('nav.openMenu')}
        closeMenuLabel={t('nav.closeMenu')}
      />
      {children}
    </div>
  )
}
