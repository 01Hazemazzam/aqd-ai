'use client'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AuthShell } from '@/components/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { GoogleButton } from '@/components/auth/google-button'
import { signIn } from './actions'

export default function LoginPage() {
  const t = useTranslations('auth.login')
  const e = useTranslations('auth.errors')
  const [state, action, pending] = useActionState(signIn, null)
  const oauthFailed = useSearchParams().get('oauthError') === '1'

  return (
    <AuthShell title={t('title')} subtitle={t('subtitle')}>
      <GoogleButton label={t('continueWithGoogle')} notConfiguredLabel={t('googleNotConfigured')} />
      <div className="my-5 flex items-center gap-3 text-xs text-ink-dim">
        <span className="h-px flex-1 bg-edge" />
        {t('orDivider')}
        <span className="h-px flex-1 bg-edge" />
      </div>
      <form action={action} className="flex flex-col gap-4">
        <Input label={t('email')} name="email" type="email" required autoComplete="email" />
        <Input label={t('password')} name="password" type="password" required autoComplete="current-password" />
        {(state?.error || oauthFailed) && (
          <p role="alert" className="text-xs text-risk-high">{state?.error ? e('invalidCredentials') : e('oauthFailed')}</p>
        )}
        <Button type="submit" loading={pending}>{t('submit')}</Button>
      </form>
      <div className="mt-6 flex flex-col gap-2 text-sm text-ink-dim">
        <Link href="/reset" className="text-accent underline">{t('forgot')}</Link>
        <span>{t('noAccount')} <Link href="/signup" className="text-accent underline">{t('signUp')}</Link></span>
      </div>
    </AuthShell>
  )
}
