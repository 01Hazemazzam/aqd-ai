'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { FilePlus2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createBrowserSupabase } from '@/lib/supabase/client'
import { MAX_UPLOAD_MB } from '@/lib/upload-limit'
import { createRevisionTarget, ingestContract } from '../actions'

type Stage = 'idle' | 'uploading' | 'processing' | 'error'
type ErrorKey =
  | 'unsupported_type'
  | 'file_too_large'
  | 'not_found'
  | 'unchanged_file'
  | 'download_failed'
  | 'parse_failed'
  | 'unknown'

/**
 * Upload the next draft of a contract that already exists.
 *
 * Same three steps as the first upload -- signed slot, direct-to-storage,
 * ingest -- but it lands the user on the comparison rather than the reader.
 * The reason to upload a returned draft is to find out what moved, and making
 * them go looking for that link would waste the one moment they are certain
 * to want it.
 */
export function RevisionUpload({ contractId }: { contractId: string }) {
  const t = useTranslations('contracts')
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [errorKey, setErrorKey] = useState<ErrorKey | null>(null)

  async function handleFile(file: File) {
    setStage('uploading')
    setErrorKey(null)

    const target = await createRevisionTarget(contractId, file.name, file.type, file.size)
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
    const result = await ingestContract(contractId, target.storagePath, file.name, file.type)
    if ('error' in result) {
      setStage('error')
      setErrorKey(result.error ?? 'unknown')
      return
    }

    router.push(`/contracts/${contractId}/compare`)
    router.refresh()
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
        variant="secondary"
        loading={stage === 'uploading' || stage === 'processing'}
        icon={<FilePlus2 size={16} aria-hidden="true" />}
        onClick={() => inputRef.current?.click()}
      >
        {stage === 'uploading' ? t('uploading') : stage === 'processing' ? t('processing') : t('revision.uploadCta')}
      </Button>
      {stage === 'error' && errorKey && (
        <p role="alert" className="mt-2 text-xs text-risk-high">
          {t(`errors.${errorKey}`, { limit: MAX_UPLOAD_MB })}
        </p>
      )}
    </div>
  )
}
