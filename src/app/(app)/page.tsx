import { getLocale } from 'next-intl/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/org/current'
import { DashboardHero } from './dashboard-hero'
import type { Locale } from '@/lib/i18n/config'

export default async function DashboardPage() {
  const locale = (await getLocale()) as Locale
  const orgId = await getCurrentOrgId()
  const supabase = await createServerSupabase()

  const [{ count: total }, { count: ready }, { count: highRisk }, { data: latest }] = await Promise.all([
    supabase.from('contracts').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
    supabase.from('contracts').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'ready'),
    supabase.from('risk_findings').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('severity', 'high'),
    supabase
      .from('analyses')
      .select('updated_at')
      .eq('org_id', orgId)
      .eq('status', 'ready')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const lastAnalysis = latest?.updated_at
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(latest.updated_at as string))
    : null

  return (
    <DashboardHero
      total={total ?? 0}
      ready={ready ?? 0}
      highRisk={highRisk ?? 0}
      lastAnalysis={lastAnalysis}
    />
  )
}
