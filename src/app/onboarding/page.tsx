'use client'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { AuthShell } from '@/components/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createOrganization } from './actions'

export default function OnboardingPage() {
  const t = useTranslations('onboarding')
  const [state, action, pending] = useActionState(createOrganization, null)

  return (
    <AuthShell title={t('title')} subtitle={t('subtitle')}>
      <form action={action} className="flex flex-col gap-4">
        <Input
          label={t('name')} name="name" required
          error={state?.error === 'invalid_name' ? t('name') : undefined}
        />
        <Button type="submit" loading={pending}>{t('submit')}</Button>
      </form>
    </AuthShell>
  )
}
