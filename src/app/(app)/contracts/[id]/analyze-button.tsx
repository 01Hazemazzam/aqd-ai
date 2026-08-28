'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { analyzeContract } from './analyze-actions'

export function AnalyzeButton({ contractId, label }: { contractId: string; label: string }) {
  const t = useTranslations('contracts')
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [errorKey, setErrorKey] = useState<string | null>(null)

  function handleClick() {
    setErrorKey(null)
    startTransition(async () => {
      const result = await analyzeContract(contractId)
      if ('error' in result) {
        setErrorKey(result.error ?? 'unknown')
        return
      }
      router.refresh()
    })
  }

  return (
    <div>
      <Button type="button" variant="secondary" loading={pending} onClick={handleClick}>
        {label}
      </Button>
      {errorKey && (
        <p role="alert" className="mt-2 text-xs text-risk-high">
          {t(`analyzeErrors.${errorKey}` as 'analyzeErrors.unknown')}
        </p>
      )}
    </div>
  )
}
