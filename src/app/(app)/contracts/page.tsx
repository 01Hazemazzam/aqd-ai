import Link from 'next/link'
import { FileText, Loader2, CheckCircle2, AlertCircle, ChevronRight } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/org/current'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { StaggerList, StaggerItem } from '@/components/ui/reveal'
import { UploadZone } from './upload-zone'

// The deployment target kills a function at 60s. Declared explicitly rather
// than left to the platform default (10s), which is shorter than a healthy
// analysis. The AI retry budget in lib/ai/router.ts is sized to fit inside
// this with room for the database writes that follow -- change one and check
// the other.
export const maxDuration = 60

const STATUS_TONE = {
  uploaded: 'neutral',
  parsing: 'accent',
  ready: 'accent',
  failed: 'neutral',
} as const

const STATUS_ICON = {
  uploaded: FileText,
  parsing: Loader2,
  ready: CheckCircle2,
  failed: AlertCircle,
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
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-serif text-3xl font-medium tracking-tight text-ink text-balance">{t('title')}</h1>
        <UploadZone />
      </div>

      {!contracts?.length && (
        <Card>
          <EmptyState
            icon={<FileText size={22} aria-hidden="true" />}
            title={t('empty')}
            action={<UploadZone />}
          />
        </Card>
      )}

      {!!contracts?.length && (
        <StaggerList className="flex flex-col gap-3">
          {contracts.map((contract) => {
            const StatusIcon = STATUS_ICON[contract.status as keyof typeof STATUS_ICON] ?? FileText
            return (
              <StaggerItem key={contract.id}>
                <Link href={`/contracts/${contract.id}`}>
                  <Card interactive className="flex items-center justify-between gap-4 py-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-ink-faint">
                        <StatusIcon size={16} strokeWidth={2} className={contract.status === 'parsing' ? 'animate-spin' : undefined} />
                      </span>
                      <span className="truncate text-sm font-medium text-ink">{contract.title}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Badge tone={STATUS_TONE[contract.status as keyof typeof STATUS_TONE]}>
                        {t(`status.${contract.status}`)}
                      </Badge>
                      <ChevronRight size={16} aria-hidden="true" className="text-ink-faint rtl:-scale-x-100" />
                    </div>
                  </Card>
                </Link>
              </StaggerItem>
            )
          })}
        </StaggerList>
      )}
    </main>
  )
}
