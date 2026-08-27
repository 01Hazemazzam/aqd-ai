'use client'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { AuthShell } from '@/components/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { signUp } from './actions'

export default function SignupPage() {
  const t = useTranslations('auth.signup')
  const e = useTranslations('auth.errors')
  const [state, action, pending] = useActionState(signUp, null)

  return (
    <AuthShell title={t('title')} subtitle={t('subtitle')}>
      <form action={action} className="flex flex-col gap-4">
        <Input
          label={t('email')} name="email" type="email" required autoComplete="email"
          error={state?.error === 'invalidEmail' ? e('invalidEmail') : undefined}
        />
        <Input
          label={t('password')} name="password" type="password" required autoComplete="new-password"
          error={state?.error === 'weakPassword' ? e('weakPassword') : undefined}
        />
        <Button type="submit" loading={pending}>{t('submit')}</Button>
      </form>
      <p className="mt-6 text-sm text-ink-dim">
        {t('haveAccount')}{' '}
        <Link href="/login" className="text-accent underline">{t('signIn')}</Link>
      </p>
    </AuthShell>
  )
}
