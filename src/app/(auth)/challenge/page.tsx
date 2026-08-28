'use client'
import { useActionState, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AuthShell } from '@/components/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { CodeInput } from '@/components/ui/code-input'
import { submitChallenge } from './actions'

export default function ChallengePage() {
  const t = useTranslations('auth.challenge')
  const e = useTranslations('auth.errors')
  const [code, setCode] = useState('')
  const [state, action, pending] = useActionState(submitChallenge, null)

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
      <form action={action} className="flex flex-col gap-5">
        <CodeInput label={t('code')} value={code} onChange={setCode} error={errorText} />
        <input type="hidden" name="code" value={code} />
        <label className="flex items-center gap-2 text-sm text-ink-dim">
          <input type="checkbox" name="trust" defaultChecked className="accent-[var(--accent)]" />
          {t('trust')}
        </label>
        <Button type="submit" loading={pending} disabled={code.length < 6}>{t('submit')}</Button>
      </form>
    </AuthShell>
  )
}
