'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { createBrowserSupabase } from '@/lib/supabase/client'
import { createUploadTarget, ingestContract } from './actions'

type Stage = 'idle' | 'uploading' | 'processing' | 'error'
type ErrorKey = 'unsupported_type' | 'file_too_large' | 'download_failed' | 'parse_failed' | 'unknown'

export function UploadZone() {
  const t = useTranslations('contracts')
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [errorKey, setErrorKey] = useState<ErrorKey | null>(null)

  async function handleFile(file: File) {
    setStage('uploading')
    setErrorKey(null)

    const target = await createUploadTarget(file.name, file.type, file.size)
    if ('error' in target) {
      setStage('error')
      setErrorKey(target.error ?? 'unknown')
      return
    }

    const supabase = createBrowserSupabase()
    const { error: uploadError } = await supabase.storage
      .from('contracts')
      .uploadToSignedUrl(target.storagePath, target.token, file)
    if (uploadError) {
      setStage('error')
      setErrorKey('unknown')
      return
    }

    setStage('processing')
    const result = await ingestContract(target.contractId, target.storagePath, file.name, file.type)
    if ('error' in result) {
      setStage('error')
      setErrorKey(result.error)
      return
    }

    router.push(`/contracts/${result.contractId}`)
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleFile(file)
          e.target.value = ''
        }}
      />
      <Button
        type="button"
        loading={stage === 'uploading' || stage === 'processing'}
        onClick={() => inputRef.current?.click()}
      >
        {stage === 'uploading' ? t('uploading')
          : stage === 'processing' ? t('processing')
          : t('uploadCta')}
      </Button>
      {stage === 'error' && errorKey && (
        <p role="alert" className="mt-2 text-xs text-risk-high">
          {t(`errors.${errorKey}`)}
        </p>
      )}
    </div>
  )
}
