'use client'
import { useActionState, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { AuthShell } from '@/components/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { CodeInput } from '@/components/ui/code-input'
import { submitVerification, resendCode } from './actions'

export default function VerifyPage() {
  const t = useTranslations('auth.verify')
  const e = useTranslations('auth.errors')
  const params = useSearchParams()
  const [code, setCode] = useState('')
  const [state, action, pending] = useActionState(submitVerification, null)

  const errorText =
    state?.error === 'code_expired' ? e('codeExpired')
    : state?.error === 'code_burned' ? e('codeBurned')
    : state?.error === 'code_incorrect' ? e('codeIncorrect', { remaining: 4 })
    : undefined

  return (
    <AuthShell title={t('title')} subtitle={t('subtitle', { email: '' })}>
      {params.get('send') === 'failed' && (
        <p role="alert" className="mb-4 rounded-lg bg-surface-3 p-3 text-sm text-ink-dim">
          {t('sendFailed')}
        </p>
      )}
      <form action={action} className="flex flex-col gap-5">
        <CodeInput label={t('code')} value={code} onChange={setCode} error={errorText} />
        <input type="hidden" name="code" value={code} />
        <Button type="submit" loading={pending} disabled={code.length < 6}>{t('submit')}</Button>
      </form>
      <form action={resendCode} className="mt-4">
        <Button type="submit" variant="ghost">{t('resend')}</Button>
      </form>
    </AuthShell>
  )
}
