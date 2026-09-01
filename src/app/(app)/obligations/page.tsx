import { getLocale, getTranslations } from 'next-intl/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/org/current'
import { buildObligationRegister, type RawObligation } from '@/lib/obligations/register'
import { ObligationsView } from './obligations-view'

type StoredObligation = { obligor: string; action: string; due: string | null }

export default async function ObligationsPage() {
  const t = await getTranslations('obligations')
  const locale = await getLocale()
  const orgId = await getCurrentOrgId()
  const supabase = await createServerSupabase()

  const [{ data: analyses }, { data: contracts }] = await Promise.all([
    supabase
      .from('analyses')
      .select('contract_id, obligations, created_at')
      .eq('org_id', orgId)
      .eq('status', 'ready')
      .order('created_at', { ascending: false }),
    supabase.from('contracts').select('id, title').eq('org_id', orgId),
  ])

  const titleById = new Map((contracts ?? []).map((c) => [c.id as string, c.title as string]))

  // One contract can have several analyses (re-analysis, new versions); rows
  // come back newest-first, so the first time a contract_id is seen is its
  // latest analysis. Later rows for the same contract are stale and skipped.
  const seen = new Set<string>()
  const rows: RawObligation[] = []
  for (const a of analyses ?? []) {
    const contractId = a.contract_id as string
    if (seen.has(contractId)) continue
    seen.add(contractId)
    const contractTitle = titleById.get(contractId)
    if (!contractTitle) continue
    for (const o of (a.obligations as StoredObligation[] | null) ?? []) {
      rows.push({ contractId, contractTitle, obligor: o.obligor, action: o.action, due: o.due })
    }
  }

  const { dated, conditional } = buildObligationRegister(rows, new Date())

  return (
    <ObligationsView
      dated={dated}
      conditional={conditional}
      locale={locale}
      strings={{
        title: t('title'),
        subtitle: t('subtitle'),
        empty: t('empty'),
        upcomingTitle: t('upcomingTitle'),
        conditionalTitle: t('conditionalTitle'),
        noDeadline: t('noDeadline'),
        urgency: { overdue: t('urgency.overdue'), soon: t('urgency.soon'), upcoming: t('urgency.upcoming') },
      }}
    />
  )
}
