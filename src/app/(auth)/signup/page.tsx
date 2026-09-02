import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { AuthShell } from '@/components/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { signupsOpen } from '@/lib/deployment'
import { SignupForm } from './signup-form'

/**
 * A server component so it can read whether this deployment takes signups.
 *
 * On a closed instance Supabase refuses the account at the source, and a form
 * that submits into a refusal is worse than no form: the visitor reads the
 * generic failure as a bug in the product they came to look at. Saying it up
 * front costs one branch and is the truth.
 */
export default async function SignupPage() {
  const t = await getTranslations('auth.signup')

  if (signupsOpen()) return <SignupForm />

  return (
    <AuthShell title={t('closedTitle')} subtitle={t('closedSubtitle')}>
      <p className="text-sm leading-relaxed text-ink-dim">{t('closedBody')}</p>
      <Link href="/login" className="mt-6 block">
        <Button className="w-full">{t('signIn')}</Button>
      </Link>
    </AuthShell>
  )
}
