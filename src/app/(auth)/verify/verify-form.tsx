'use client'
import { useActionState, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { AuthShell } from '@/components/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { CodeInput } from '@/components/ui/code-input'
import { submitVerification, resendCode } from './actions'
import { signOut } from '@/lib/auth/sign-out'

export function VerifyForm({ devHint }: { devHint?: ReactNode }) {
  const t = useTranslations('auth.verify')
  const a = useTranslations('auth')
  const e = useTranslations('auth.errors')
  const params = useSearchParams()
  const [code, setCode] = useState('')
  const [state, action, pending] = useActionState(submitVerification, null)
  const [resendState, resendAction, resendPending] = useActionState(resendCode, null)

  // The final `state?.error ?` branch matters: without it an unrecognised
  // failure set `errorText` to undefined and the form appeared to do nothing
  // at all on submit.
  const errorText =
    state?.error === 'code_expired' ? e('codeExpired')
    : state?.error === 'code_burned' ? e('codeBurned')
    : state?.error === 'code_incorrect' ? e('codeIncorrect', { remaining: 4 })
    : state?.error === 'rate_limited' ? e('rateLimited')
    : state?.error ? e('unknown')
    : undefined

  return (
    <AuthShell title={t('title')} subtitle={t('subtitle', { email: '' })}>
      {devHint}
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
      <form action={resendAction} className="mt-4">
        <Button type="submit" variant="ghost" loading={resendPending}>{a('resend')}</Button>
      </form>
      {resendState?.error && (
        <p role="alert" className="mt-2 text-xs text-risk-high">{e('unknown')}</p>
      )}
      {resendState?.sent && (
        <p role="status" className="mt-2 text-xs text-ink-dim">{a('resent')}</p>
      )}

      <form action={signOut} className="mt-6">
        <button type="submit" className="text-sm text-accent underline">{a('notYou')}</button>
      </form>
    </AuthShell>
  )
}
