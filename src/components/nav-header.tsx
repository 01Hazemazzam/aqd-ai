'use client'
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { FileText, Radar, HelpCircle, Users, ShieldCheck, Menu, X, LogOut } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { SettingsToggles } from '@/components/settings-toggles'
import { cn } from '@/components/ui/cn'

const ICON = { contracts: FileText, intelligence: Radar, help: HelpCircle, team: Users, security: ShieldCheck } as const

export interface NavLink {
  href: string
  key: keyof typeof ICON
  label: string
}

export function NavHeader({
  appName,
  orgName,
  links,
  signOutLabel,
  signOutAction,
  openMenuLabel,
  closeMenuLabel,
}: {
  appName: string
  orgName?: string | null
  links: NavLink[]
  signOutLabel: string
  signOutAction: () => void | Promise<void>
  openMenuLabel: string
  closeMenuLabel: string
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-40 border-b border-edge bg-surface-2/85 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3 sm:px-10">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-wordmark text-lg font-semibold tracking-tight text-ink">
            {appName}
          </Link>
          {/* lg, not md: six inline links plus the org name, settings toggles
              and sign-out need ~912px, so switching at 768px overflowed the
              header horizontally across the whole tablet range. */}
          <nav className="hidden items-center gap-1 lg:flex">
            {links.map((link) => {
              const Icon = ICON[link.key]
              const active = pathname === link.href || pathname?.startsWith(`${link.href}/`)
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                    active ? 'bg-surface-3 text-ink' : 'text-ink-dim hover:bg-surface-3 hover:text-ink',
                  )}
                >
                  <Icon aria-hidden="true" size={15} strokeWidth={2} />
                  {link.label}
                </Link>
              )
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {orgName && <span className="hidden text-sm text-ink-faint sm:inline">{orgName}</span>}
          <div className="hidden sm:flex sm:items-center sm:gap-3">
            <SettingsToggles />
            <form action={signOutAction}>
              <button
                type="submit"
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-edge bg-surface-2 px-2.5 text-xs font-medium text-ink-dim transition-colors hover:bg-surface-3 hover:text-ink"
              >
                {signOutLabel}
              </button>
            </form>
          </div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? closeMenuLabel : openMenuLabel}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-dim transition-colors hover:bg-surface-3 hover:text-ink lg:hidden"
          >
            {open ? <X aria-hidden="true" size={20} /> : <Menu aria-hidden="true" size={20} />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.nav
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-t border-edge bg-surface-2 lg:hidden"
          >
            <div className="flex flex-col gap-1 px-6 py-3">
              {links.map((link) => {
                const Icon = ICON[link.key]
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-ink-dim hover:bg-surface-3 hover:text-ink"
                  >
                    <Icon aria-hidden="true" size={16} strokeWidth={2} />
                    {link.label}
                  </Link>
                )
              })}
              <div className="mt-2 flex items-center justify-between gap-3 border-t border-edge pt-3">
                <SettingsToggles />
                <form action={signOutAction}>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-dim hover:bg-surface-3 hover:text-ink"
                  >
                    <LogOut aria-hidden="true" size={14} />
                    {signOutLabel}
                  </button>
                </form>
              </div>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  )
}
