'use client'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { AuthShell } from '@/components/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { signIn } from './actions'

export default function LoginPage() {
  const t = useTranslations('auth.login')
  const e = useTranslations('auth.errors')
  const [state, action, pending] = useActionState(signIn, null)

  return (
    <AuthShell title={t('title')} subtitle={t('subtitle')}>
      <form action={action} className="flex flex-col gap-4">
        <Input label={t('email')} name="email" type="email" required autoComplete="email" />
        <Input label={t('password')} name="password" type="password" required autoComplete="current-password" />
        {state?.error && <p role="alert" className="text-xs text-risk-high">{e('invalidCredentials')}</p>}
        <Button type="submit" loading={pending}>{t('submit')}</Button>
      </form>
      <div className="mt-6 flex flex-col gap-2 text-sm text-ink-dim">
        <Link href="/reset" className="text-accent underline">{t('forgot')}</Link>
        <span>{t('noAccount')} <Link href="/signup" className="text-accent underline">{t('signUp')}</Link></span>
      </div>
    </AuthShell>
  )
}
