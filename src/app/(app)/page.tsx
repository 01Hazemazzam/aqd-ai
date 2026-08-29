import Link from 'next/link'
import { FileText, FileCheck2, ArrowUpRight } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/org/current'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FadeIn } from '@/components/ui/reveal'

export default async function DashboardPage() {
  const d = await getTranslations('dashboard')
  const orgId = await getCurrentOrgId()
  const supabase = await createServerSupabase()

  const [{ count: total }, { count: ready }] = await Promise.all([
    supabase.from('contracts').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
    supabase.from('contracts').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'ready'),
  ])

  const stats = [
    { label: d('stats.totalContracts'), value: total ?? 0, icon: FileText },
    { label: d('stats.readyContracts'), value: ready ?? 0, icon: FileCheck2 },
  ]

  return (
    <main className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-96"
        style={{
          backgroundImage:
            'radial-gradient(circle at 15% 0%, color-mix(in oklch, var(--accent) 10%, transparent) 0%, transparent 45%),' +
            'radial-gradient(circle at 85% 15%, color-mix(in oklch, var(--brass) 10%, transparent) 0%, transparent 40%)',
        }}
      />
      <div className="mx-auto max-w-3xl px-6 py-20 sm:px-10">
        <FadeIn>
          <h1 className="font-serif text-4xl font-medium tracking-tight text-ink text-balance">
            {d('welcome')}
          </h1>
          <p className="mt-2 text-sm text-ink-dim">{d('subtitle')}</p>
        </FadeIn>

        <div className="mt-8 grid grid-cols-2 gap-4 sm:max-w-sm">
          {stats.map((stat, i) => (
            <FadeIn key={stat.label} delay={0.08 + i * 0.06}>
              <Card className="flex items-center gap-3">
                <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                  <stat.icon size={18} strokeWidth={2} />
                </span>
                <div>
                  <p className="font-serif text-2xl font-semibold tabular-nums leading-none text-ink">{stat.value}</p>
                  <p className="mt-1 text-xs text-ink-faint">{stat.label}</p>
                </div>
              </Card>
            </FadeIn>
          ))}
        </div>

        <FadeIn delay={0.2}>
          <Card interactive className="mt-6 flex items-start gap-4">
            <span aria-hidden="true" className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brass/15 text-brass">
              <FileText size={18} strokeWidth={2} />
            </span>
            <div className="flex-1">
              <p className="text-sm leading-relaxed text-ink-dim">{d('subtitle')}</p>
              <Link href="/contracts" className="mt-4 inline-block">
                <Button type="button" variant="secondary" icon={<ArrowUpRight size={15} aria-hidden="true" />}>
                  {d('viewContracts')}
                </Button>
              </Link>
            </div>
          </Card>
        </FadeIn>
      </div>
    </main>
  )
}
