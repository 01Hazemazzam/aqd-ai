import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/org/current'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { UploadZone } from './upload-zone'

const STATUS_TONE = {
  uploaded: 'neutral',
  parsing: 'accent',
  ready: 'accent',
  failed: 'neutral',
} as const

export default async function ContractsPage() {
  const t = await getTranslations('contracts')
  const orgId = await getCurrentOrgId()
  const supabase = await createServerSupabase()
  const { data: contracts } = await supabase
    .from('contracts')
    .select('id, title, status, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  return (
    <main className="mx-auto max-w-3xl px-6 py-20 sm:px-10">
      <div className="mb-8 flex items-center justify-between gap-4">
        <h1 className="font-serif text-3xl font-medium tracking-tight text-ink text-balance">{t('title')}</h1>
        <UploadZone />
      </div>

      {!contracts?.length && (
        <Card>
          <p className="text-sm text-ink-dim">{t('empty')}</p>
        </Card>
      )}

      {!!contracts?.length && (
        <ul className="flex flex-col gap-3">
          {contracts.map((contract) => (
            <li key={contract.id}>
              <Link href={`/contracts/${contract.id}`}>
                <Card className="flex items-center justify-between gap-4 transition-colors hover:bg-surface-3">
                  <span className="text-sm font-medium text-ink">{contract.title}</span>
                  <Badge tone={STATUS_TONE[contract.status as keyof typeof STATUS_TONE]}>
                    {t(`status.${contract.status}`)}
                  </Badge>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
