'use client'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { AuthShell } from '@/components/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { GoogleButton } from '@/components/auth/google-button'
import { signUp } from './actions'

export function SignupForm() {
  const t = useTranslations('auth.signup')
  const e = useTranslations('auth.errors')
  const [state, action, pending] = useActionState(signUp, null)

  return (
    <AuthShell title={t('title')} subtitle={t('subtitle')}>
      <GoogleButton label={t('continueWithGoogle')} notConfiguredLabel={t('googleNotConfigured')} />
      <div className="my-5 flex items-center gap-3 text-xs text-ink-dim">
        <span className="h-px flex-1 bg-edge" />
        {t('orDivider')}
        <span className="h-px flex-1 bg-edge" />
      </div>
      <form action={action} className="flex flex-col gap-4">
        <Input
          label={t('email')} name="email" type="email" required autoComplete="email"
          error={state?.error === 'invalidEmail' ? e('invalidEmail') : undefined}
        />
        <Input
          label={t('password')} name="password" type="password" required autoComplete="new-password"
          error={state?.error === 'weakPassword' ? e('weakPassword') : undefined}
        />
        {/* Anything that is not a field-level complaint had no rendering at
            all: the two Input errors match camelCase issues from validate.ts,
            while the action also returns snake_case codes from GoTrue, so a
            refused signup left the form sitting there saying nothing. A
            closed deployment makes that reachable on purpose. */}
        {state?.error && state.error !== 'invalidEmail' && state.error !== 'weakPassword' && (
          <p role="alert" className="text-xs text-risk-high">
            {state.error === 'signups_closed' ? e('signupsClosed') : e('unknown')}
          </p>
        )}
        <Button type="submit" loading={pending}>{t('submit')}</Button>
      </form>
      <p className="mt-6 text-sm text-ink-dim">
        {t('haveAccount')}{' '}
        <Link href="/login" className="text-accent underline">{t('signIn')}</Link>
      </p>
    </AuthShell>
  )
}
