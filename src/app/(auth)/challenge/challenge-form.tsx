'use client'
import { useActionState, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { AuthShell } from '@/components/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { CodeInput } from '@/components/ui/code-input'
import { submitChallenge, resendChallenge } from './actions'
import { signOut } from '@/lib/auth/sign-out'

export function ChallengeForm({ devHint }: { devHint?: ReactNode }) {
  const t = useTranslations('auth.challenge')
  const a = useTranslations('auth')
  const e = useTranslations('auth.errors')
  const [code, setCode] = useState('')
  const [state, action, pending] = useActionState(submitChallenge, null)
  const [resendState, resendAction, resendPending] = useActionState(resendChallenge, null)

  // Each branch is explicit. A catch-all `state?.error ?` here would report
  // *any* failure -- including an auth or network error -- as a wrong code,
  // telling the user something untrue about an attempt that never counted.
  const errorText =
    state?.error === 'code_expired' ? e('codeExpired')
    : state?.error === 'code_burned' ? e('codeBurned')
    : state?.error === 'code_incorrect' ? e('codeIncorrect', { remaining: 4 })
    : state?.error === 'rate_limited' ? e('rateLimited')
    : state?.error ? e('unknown')
    : undefined

  return (
    <AuthShell title={t('title')} subtitle={t('subtitle')}>
      {devHint}
      <form action={action} className="flex flex-col gap-5">
        <CodeInput label={t('code')} value={code} onChange={setCode} error={errorText} />
        <input type="hidden" name="code" value={code} />
        <label className="flex items-center gap-2 text-sm text-ink-dim">
          <input type="checkbox" name="trust" defaultChecked className="accent-[var(--accent)]" />
          {t('trust')}
        </label>
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
