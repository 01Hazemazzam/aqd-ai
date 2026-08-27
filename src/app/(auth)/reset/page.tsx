'use client'
import { useActionState, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { AuthShell } from '@/components/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CodeInput } from '@/components/ui/code-input'
import { requestReset, confirmReset } from './actions'

export default function ResetPage() {
  const t = useTranslations('auth.reset')
  const e = useTranslations('auth.errors')
  const params = useSearchParams()
  const step = params.get('step')
  const email = params.get('email') ?? ''
  const [code, setCode] = useState('')
  const [, reqAction, reqPending] = useActionState(requestReset, null)
  const [confState, confAction, confPending] = useActionState(confirmReset, null)

  if (step === 'confirm') {
    return (
      <AuthShell title={t('title')} subtitle={t('subtitle')}>
        <form action={confAction} className="flex flex-col gap-5">
          <CodeInput
            label={t('code')} value={code} onChange={setCode}
            error={confState?.error === 'code_incorrect' ? e('codeIncorrect', { remaining: 4 }) : undefined}
          />
          <input type="hidden" name="code" value={code} />
          <input type="hidden" name="email" value={email} />
          <Input
            label={t('newPassword')} name="password" type="password" required autoComplete="new-password"
            error={confState?.error === 'weakPassword' ? e('weakPassword') : undefined}
          />
          <Button type="submit" loading={confPending} disabled={code.length < 6}>{t('confirm')}</Button>
        </form>
      </AuthShell>
    )
  }

  return (
    <AuthShell title={t('title')} subtitle={t('subtitle')}>
      <form action={reqAction} className="flex flex-col gap-4">
        <Input label={t('email')} name="email" type="email" required autoComplete="email" />
        <Button type="submit" loading={reqPending}>{t('submit')}</Button>
      </form>
    </AuthShell>
  )
}
